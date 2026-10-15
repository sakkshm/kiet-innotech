#!/bin/bash
# InnoTech'26 deployment, run from a laptop with Docker and the AWS CLI.
#
#   ./deploy.sh stack       create/update the AWS resources (CloudFormation stack)
#   ./deploy.sh api         build-api + release-api
#   ./deploy.sh sites       build-sites + publish-sites
#   ./deploy.sh all         stack + api + sites
#   ./deploy.sh status      URLs, health and running containers
#   ./deploy.sh logs        last API/Caddy log lines
#   ./deploy.sh backup      take a database backup now
#   ./deploy.sh shell       open a shell on the instance (needs the Session Manager plugin)
#   ./deploy.sh destroy     final backup, then delete everything except the backups bucket
#
#   The steps GitHub Actions runs (.github/workflows/deploy.yml), usable by hand too:
#   ./deploy.sh build-api       build the API image and push it (changes nothing that is live)
#   ./deploy.sh release-api     back up, rehearse the migrations on a copy, migrate, switch; rolls back on failure
#   ./deploy.sh build-sites     build both static sites (changes nothing that is live)
#   ./deploy.sh publish-sites   upload both sites and switch the instance to them
#   ./deploy.sh smoke           check the public URLs answer
#   ./deploy.sh rollback api|sites   put the previous release back
#   ./deploy.sh ci              create/update the GitHub deploy role (CloudFormation stack <stack>-ci)
#
# Settings live in deploy/production.env (copy production.env.example). The script refuses to run against any AWS
# account other than AWS_ACCOUNT_ID in that file.
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$DEPLOY_DIR")"
CONFIG="$DEPLOY_DIR/production.env"

[ -f "$CONFIG" ] || { echo "Missing $CONFIG. Copy production.env.example and fill it in." >&2; exit 1; }
set -a
# shellcheck source=/dev/null
source "$CONFIG"
set +a
: "${AWS_ACCOUNT_ID:?Set AWS_ACCOUNT_ID in production.env}"
if [ -n "${GITHUB_ACTIONS:-}" ]; then
  # GitHub Actions signs in with the deploy role's short-lived credentials, not a local profile.
  unset AWS_PROFILE
else
  : "${AWS_PROFILE:?Set AWS_PROFILE in production.env}"
  export AWS_PROFILE
fi
export AWS_REGION="${AWS_REGION:-ap-south-1}" AWS_PAGER=""
STACK="${STACK_NAME:-innotech}"

check_account() {
  local actual
  actual="$(aws sts get-caller-identity --query Account --output text)"
  if [ "$actual" != "$AWS_ACCOUNT_ID" ]; then
    echo "AWS credentials (${AWS_PROFILE:-GitHub Actions role}) are account $actual, but production.env says $AWS_ACCOUNT_ID. Stopping." >&2
    exit 1
  fi
  echo "AWS account $actual (${AWS_PROFILE:-GitHub Actions role}), region $AWS_REGION, stack $STACK"
}

output() {
  aws cloudformation describe-stacks --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

# Runs a shell command on the instance through SSM and prints its output.
remote() {
  local instance command_id status
  instance="$(output InstanceId)"
  command_id="$(aws ssm send-command --instance-ids "$instance" --document-name AWS-RunShellScript \
    --parameters "$(jq -n --arg c "$1" '{commands: [$c], executionTimeout: ["1800"]}')" \
    --query Command.CommandId --output text)"
  while true; do
    sleep 3
    status="$(aws ssm get-command-invocation --command-id "$command_id" --instance-id "$instance" --query Status --output text 2>/dev/null || echo Pending)"
    case "$status" in Pending | InProgress | Delayed) continue ;; esac
    break
  done
  aws ssm get-command-invocation --command-id "$command_id" --instance-id "$instance" --query StandardOutputContent --output text
  if [ "$status" != "Success" ]; then
    aws ssm get-command-invocation --command-id "$command_id" --instance-id "$instance" --query StandardErrorContent --output text >&2
    echo "Remote command $status." >&2
    return 1
  fi
}

current_ami() {
  [ -n "${AMI_ID:-}" ] && { echo "$AMI_ID"; return; }
  local instance
  instance="$(aws cloudformation describe-stacks --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='InstanceId'].OutputValue" --output text 2>/dev/null || true)"
  if [ -n "$instance" ] && [ "$instance" != "None" ]; then
    aws ec2 describe-instances --instance-ids "$instance" --query 'Reservations[0].Instances[0].ImageId' --output text
  else
    aws ssm get-parameter --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64 --query Parameter.Value --output text
  fi
}

# Resources whose replacement would change the public IP, lose the server's disk or lose the backups.
PROTECTED="ApiInstance ApiAddress OpsBucket"

deploy_stack() {
  local name type changes risky reason
  name="deploy-$(date +%s)"
  type=UPDATE
  aws cloudformation describe-stacks --stack-name "$STACK" >/dev/null 2>&1 || type=CREATE
  aws cloudformation create-change-set --stack-name "$STACK" --change-set-name "$name" --change-set-type "$type" \
    --template-body "file://$DEPLOY_DIR/cloudformation.yml" --capabilities CAPABILITY_IAM \
    --parameters "$(jq -n --arg t "${INSTANCE_TYPE:-t4g.medium}" --arg e "${ALERT_EMAIL:-}" --arg a "$(current_ami)" \
      '[{ParameterKey:"InstanceType",ParameterValue:$t},{ParameterKey:"AlertEmail",ParameterValue:$e},{ParameterKey:"AmiId",ParameterValue:$a}]')" >/dev/null
  if ! aws cloudformation wait change-set-create-complete --stack-name "$STACK" --change-set-name "$name" 2>/dev/null; then
    reason="$(aws cloudformation describe-change-set --stack-name "$STACK" --change-set-name "$name" --query StatusReason --output text)"
    aws cloudformation delete-change-set --stack-name "$STACK" --change-set-name "$name"
    case "$reason" in *"didn't contain changes"* | *"No updates"*) echo "No infrastructure changes."; status; return ;; esac
    echo "Change set failed: $reason" >&2
    exit 1
  fi
  changes="$(aws cloudformation describe-change-set --stack-name "$STACK" --change-set-name "$name" \
    --query 'Changes[].ResourceChange.[LogicalResourceId,Action,Replacement]' --output text)"
  echo "Planned changes (resource, action, replacement):"
  printf '  %s\n' "${changes:-(template only)}"
  risky="$(echo "$changes" | awk -v p=" $PROTECTED " 'index(p, " " $1 " ") && ($2 == "Remove" || $3 == "True" || $3 == "Conditional") {print $1}')"
  if [ -n "$risky" ] && [ "$type" = UPDATE ] && [ "${ALLOW_REPLACE:-}" != "yes" ]; then
    aws cloudformation delete-change-set --stack-name "$STACK" --change-set-name "$name"
    echo "Refusing: this would replace or remove $(echo "$risky" | tr '\n' ' ')(new IP / lost disk / lost backups)." >&2
    echo "If that is really intended, take a backup first and run again with ALLOW_REPLACE=yes." >&2
    exit 1
  fi
  aws cloudformation execute-change-set --stack-name "$STACK" --change-set-name "$name"
  if [ "$type" = CREATE ]; then
    aws cloudformation wait stack-create-complete --stack-name "$STACK"
  else
    aws cloudformation wait stack-update-complete --stack-name "$STACK"
  fi
  status
}

# Extra hostnames (KIET subdomain) go live only once they resolve to our IP; otherwise Caddy would keep failing to get
# certificates for them and could hit Let's Encrypt's rate limits.
check_dns() {
  local ip host resolved
  ip="$(output PublicIp)"
  for host in $(echo "$*" | tr ',' ' '); do
    resolved="$(dig +short A "$host" @1.1.1.1 | tail -1)"
    if [ "$resolved" != "$ip" ]; then
      echo "$host resolves to '${resolved:-nothing}', not $ip. Wait for KIET's DNS record, then deploy again." >&2
      exit 1
    fi
  done
}

wait_for_instance() {
  local instance
  instance="$(output InstanceId)"
  echo "Waiting for the instance to register with SSM and finish its first boot..."
  for _ in $(seq 1 60); do
    if [ "$(aws ssm describe-instance-information --filters "Key=InstanceIds,Values=$instance" --query 'length(InstanceInformationList)' --output text)" = "1" ]; then
      remote "for i in \$(seq 1 60); do docker compose version >/dev/null 2>&1 && [ -f /opt/innotech/bootstrap.env ] && exit 0; sleep 5; done; echo 'Docker not ready' >&2; exit 1" >/dev/null
      return
    fi
    sleep 10
  done
  echo "The instance did not come up in SSM. Check it in the EC2 console." >&2
  exit 1
}

api_tag() {
  # A dirty tree gets a one-off tag; build-api and release-api in one run share it through .api-tag.
  if git -C "$ROOT" diff --quiet HEAD -- server; then
    git -C "$ROOT" rev-parse --short HEAD
  else
    cat "$DEPLOY_DIR/.api-tag" 2>/dev/null || echo "$(git -C "$ROOT" rev-parse --short HEAD)-dirty-$(date +%s)" | tee "$DEPLOY_DIR/.api-tag"
  fi
}

# Records the commit that is live, so GitHub Actions knows what changed since (release/deployed-api|sites.sha).
# A rollback puts the previous mark back, so the next run deploys the rolled-back change again.
mark_deployed() {
  local ops
  ops="$(output OpsBucket)"
  aws s3 cp --quiet "s3://$ops/release/deployed-$1.sha" "s3://$ops/release/deployed-$1.prev.sha" 2>/dev/null || true
  git -C "$ROOT" rev-parse HEAD | aws s3 cp --quiet - "s3://$ops/release/deployed-$1.sha"
}

unmark_deployed() {
  local ops
  ops="$(output OpsBucket)"
  aws s3 cp --quiet "s3://$ops/release/deployed-$1.prev.sha" "s3://$ops/release/deployed-$1.sha" 2>/dev/null ||
    aws s3 rm --quiet "s3://$ops/release/deployed-$1.sha"
}

build_api() {
  local repo tag
  repo="$(output EcrRepository)"
  tag="$(api_tag)"
  echo "Building API image $repo:$tag (linux/arm64)..."
  aws ecr get-login-password | docker login --username AWS --password-stdin "${repo%%/*}" >/dev/null
  docker buildx build --platform linux/arm64 -t "$repo:$tag" --push "$ROOT/server"
}

release_api() {
  : "${GOOGLE_CLIENT_IDS:?Set GOOGLE_CLIENT_IDS in production.env}" "${SUPER_ADMIN_EMAILS:?Set SUPER_ADMIN_EMAILS in production.env}"
  local tag ops portal admin api_host
  check_dns "${PORTAL_EXTRA_HOSTS:-}" "${ADMIN_EXTRA_HOSTS:-}" "${API_EXTRA_HOSTS:-}"
  ops="$(output OpsBucket)"
  portal="${PORTAL_ORIGIN:-https://$(output PortalHost)}"
  admin="${ADMIN_ORIGIN:-https://$(output AdminHost)}"
  api_host="$(output ApiHost)${API_EXTRA_HOSTS:+, $API_EXTRA_HOSTS}"
  tag="$(api_tag)"
  aws ecr describe-images --repository-name "$(output EcrRepository | cut -d/ -f2)" --image-ids imageTag="$tag" >/dev/null \
    || { echo "Image $tag is not in ECR. Run ./deploy.sh build-api first." >&2; exit 1; }

  # Non-secret settings; the instance adds its own secrets (database password, session secret).
  local config sender="${EMAIL_SENDER:-"InnoTech'26 <no-reply@innotech.kiet.edu>"}"
  config="$(mktemp)"
  cat > "$config" <<EOF
ENVIRONMENT=production
CORS_ORIGINS=$portal,$admin,https://$(output PortalHost),https://$(output AdminHost)${EXTRA_CORS_ORIGINS:+,$EXTRA_CORS_ORIGINS}
GOOGLE_CLIENT_IDS=$GOOGLE_CLIENT_IDS
SUPER_ADMIN_EMAILS=$SUPER_ADMIN_EMAILS
REGISTRATION_OPENS=${REGISTRATION_OPENS:-2026-10-03T00:00:00+05:30}
REGISTRATION_CLOSES=${REGISTRATION_CLOSES:-2026-10-15T23:59:59+05:30}
${REGISTRATION_EXTENDED_CLOSES:+REGISTRATION_EXTENDED_CLOSES=$REGISTRATION_EXTENDED_CLOSES}
NOMINATIONS_DEADLINE=${NOMINATIONS_DEADLINE:-2026-10-24T18:00:00+05:30}
RESULTS_PUBLISH_FROM=${RESULTS_PUBLISH_FROM:-2026-10-26T00:00:00+05:30}
EMAIL_BACKEND=${EMAIL_BACKEND:-log}
SES_REGION=${SES_REGION:-$AWS_REGION}
EMAIL_SENDER="$sender"
PORTAL_URL=$portal
INVITATIONS_PER_TEAM_PER_DAY=${INVITATIONS_PER_TEAM_PER_DAY:-20}
WEB_CONCURRENCY=${WEB_CONCURRENCY:-3}
API_HOSTS=$api_host
PORTAL_HOSTS=$(output PortalHost)${PORTAL_EXTRA_HOSTS:+, $PORTAL_EXTRA_HOSTS}
ADMIN_HOSTS=$(output AdminHost)${ADMIN_EXTRA_HOSTS:+, $ADMIN_EXTRA_HOSTS}
EOF
  aws s3 cp --quiet "$config" "s3://$ops/release/config.env"
  rm -f "$config"
  for file in compose.yml Caddyfile remote/update.sh remote/backup.sh remote/sync-sites.sh; do
    aws s3 cp --quiet "$DEPLOY_DIR/$file" "s3://$ops/release/$(basename "$file")"
  done

  wait_for_instance
  echo "Rolling out $tag..."
  remote "aws s3 cp --quiet s3://$ops/release/update.sh /opt/innotech/update.sh && chmod 700 /opt/innotech/update.sh && /opt/innotech/update.sh $tag"
  rm -f "$DEPLOY_DIR/.api-tag"
  git -C "$ROOT" diff --quiet HEAD -- server deploy && mark_deployed api
  echo "API: https://$(output ApiHost)/health"
}

build_site() {
  local app="$1" api_url="$2"
  echo "Building $app..."
  docker run --rm -v "$ROOT/$app:/app" -v "innotech-$app-nm:/app/node_modules" -w /app \
    -e NEXT_PUBLIC_API_MODE=live -e NEXT_PUBLIC_API_URL="$api_url" -e NEXT_PUBLIC_GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_IDS%%,*}" \
    -e NEXT_PUBLIC_REGISTRATION_OPENS="${REGISTRATION_OPENS:-}" -e NEXT_PUBLIC_REGISTRATION_CLOSES="${REGISTRATION_CLOSES:-}" \
    -e NEXT_TELEMETRY_DISABLED=1 node:22-alpine sh -c "npm ci --no-audit --no-fund && npm run build"
}

# Chained with && so a failed upload never reaches the switch, even when called in an `if`.
upload_site() {
  local app="$1" site="$2" ops
  ops="$(output OpsBucket)"
  # Hashed assets first, then pages, so a page never points at a missing file; the instance then switches to it.
  aws s3 sync --quiet "$ROOT/$app/out/_next/static" "s3://$ops/sites/$site/_next/static" &&
    aws s3 sync --quiet "$ROOT/$app/out" "s3://$ops/sites/$site" --delete &&
    aws s3 cp --quiet "$DEPLOY_DIR/remote/sync-sites.sh" "s3://$ops/release/sync-sites.sh" &&
    remote "aws s3 cp --quiet s3://$ops/release/sync-sites.sh /opt/innotech/sync-sites.sh && chmod 700 /opt/innotech/sync-sites.sh && /opt/innotech/sync-sites.sh $site"
}

build_sites() {
  : "${GOOGLE_CLIENT_IDS:?Set GOOGLE_CLIENT_IDS in production.env}"
  local api_url="${API_URL:-https://$(output ApiHost)}"
  build_site client "$api_url"
  build_site admin-panel "$api_url"
}

publish_sites() {
  local app
  for app in client admin-panel; do
    [ -s "$ROOT/$app/out/index.html" ] || { echo "$app has no build in $app/out. Run ./deploy.sh build-sites first." >&2; exit 1; }
  done
  upload_site client portal
  if ! upload_site admin-panel admin; then
    echo "The admin site failed to publish; switching the portal back too." >&2
    remote "/opt/innotech/sync-sites.sh --rollback portal"
    exit 1
  fi
  git -C "$ROOT" diff --quiet HEAD -- client admin-panel deploy && mark_deployed sites
  echo "Portal: https://$(output PortalHost)"
  echo "Admin:  https://$(output AdminHost)"
}

# The public URLs visitors use answer, through DNS, HTTPS and Caddy. Retries for about a minute.
smoke() {
  local api="${API_URL:-https://$(output ApiHost)}" portal="${PORTAL_ORIGIN:-https://$(output PortalHost)}"
  local admin="${ADMIN_ORIGIN:-https://$(output AdminHost)}" url ok
  for url in "$api/health" "$api/config" "$portal/" "$portal/login/" "$admin/" "$admin/login/"; do
    ok=""
    for _ in $(seq 1 12); do
      if curl -fsS --max-time 10 -o /dev/null "$url"; then ok=1; break; fi
      sleep 5
    done
    [ -n "$ok" ] || { echo "FAILED: $url" >&2; return 1; }
    echo "ok  $url"
  done
  curl -fsS --max-time 10 "$api/health" | grep -q '"ok"' || { echo "FAILED: $api/health is not ok" >&2; return 1; }
}

rollback() {
  case "${1:-}" in
    api)
      remote "/opt/innotech/update.sh --rollback"
      unmark_deployed api
      ;;
    sites)
      remote "/opt/innotech/sync-sites.sh --rollback portal && /opt/innotech/sync-sites.sh --rollback admin"
      unmark_deployed sites
      ;;
    *) echo "usage: deploy.sh rollback api|sites" >&2; exit 1 ;;
  esac
  echo "Rolled back $1. GitHub Actions deploys again on the next push to main."
}

# The IAM role GitHub Actions deploys with (OpenID Connect, no stored keys), in its own stack.
deploy_ci() {
  local repo subject
  repo="$(git -C "$ROOT" remote get-url origin | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##')"
  # Repositories with immutable subjects sign tokens as repo:owner@<id>/name@<id>; ask GitHub which applies.
  subject="$(gh api "repos/$repo/actions/oidc/customization/sub" --jq 'if .use_immutable_subject then .sub_claim_prefix else empty end' 2>/dev/null || true)"
  subject="${subject:-repo:$repo}"
  echo "GitHub token subject: $subject:environment:production"
  aws cloudformation deploy --stack-name "$STACK-ci" --template-file "$DEPLOY_DIR/github-ci.yml" --capabilities CAPABILITY_NAMED_IAM \
    --no-fail-on-empty-changeset --parameter-overrides "GitHubSubject=$subject" "InstanceId=$(output InstanceId)" \
    "OpsBucket=$(output OpsBucket)" "EcrRepository=$(output EcrRepository | cut -d/ -f2)" "MainStack=$STACK"
  aws cloudformation describe-stacks --stack-name "$STACK-ci" --query "Stacks[0].Outputs[?OutputKey=='RoleArn'].OutputValue" --output text
}

status() {
  echo "Portal:   https://$(output PortalHost)"
  echo "Admin:    https://$(output AdminHost)"
  echo "API:      https://$(output ApiHost)   (IP $(output PublicIp))"
  echo "Instance: $(output InstanceId)"
  curl -fsS --max-time 10 "https://$(output ApiHost)/health" && echo || echo "API health check failed (normal before the first './deploy.sh api')."
}

destroy() {
  echo "This deletes the server and its database volume. The ops bucket with the backups ($(output OpsBucket)) is kept."
  read -r -p "Type the stack name ($STACK) to confirm: " answer
  [ "$answer" = "$STACK" ] || { echo "Cancelled."; exit 1; }
  remote "/opt/innotech/backup.sh" || { read -r -p "Final backup failed. Delete anyway? [y/N] " yes; [ "$yes" = y ] || exit 1; }
  aws cloudformation delete-stack --stack-name "$STACK"
  aws cloudformation wait stack-delete-complete --stack-name "$STACK"
  echo "Deleted. Backups remain in the ops bucket until you empty and delete it."
  echo "The public IP $(aws ec2 describe-addresses --filters Name=tag:aws:cloudformation:stack-name,Values="$STACK" --query 'Addresses[0].PublicIp' --output text 2>/dev/null) is kept (about \$3.65/month)."
  echo "Release it once KIET has removed the DNS records: aws ec2 release-address --allocation-id <id from the EC2 console>"
}

check_account
case "${1:-}" in
  stack) deploy_stack ;;
  api) build_api && release_api ;;
  sites) build_sites && publish_sites ;;
  all) deploy_stack && build_api && release_api && build_sites && publish_sites ;;
  build-api) build_api ;;
  release-api) release_api ;;
  build-sites) build_sites ;;
  publish-sites) publish_sites ;;
  smoke) smoke ;;
  rollback) rollback "${2:-}" ;;
  ci) deploy_ci ;;
  status) status ;;
  logs) remote "cd /opt/innotech && docker compose logs --tail ${2:-100} api caddy" ;;
  backup) remote "/opt/innotech/backup.sh" ;;
  shell) aws ssm start-session --target "$(output InstanceId)" ;;
  destroy) destroy ;;
  *) sed -n '2,25p' "$0"; exit 1 ;;
esac
