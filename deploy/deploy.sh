#!/bin/bash
# InnoTech'26 deployment, run from a laptop with Docker and the AWS CLI.
#
#   ./deploy.sh stack       create/update the AWS resources (CloudFormation stack)
#   ./deploy.sh api         build the API image, push it and roll it out on the instance
#   ./deploy.sh sites       build both static sites and publish them on the instance (Caddy serves them)
#   ./deploy.sh all         stack + api + sites
#   ./deploy.sh status      URLs, health and running containers
#   ./deploy.sh logs        last API/Caddy log lines
#   ./deploy.sh backup      take a database backup now
#   ./deploy.sh shell       open a shell on the instance (needs the Session Manager plugin)
#   ./deploy.sh destroy     final backup, then delete everything except the backups bucket
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
: "${AWS_PROFILE:?Set AWS_PROFILE in production.env}" "${AWS_ACCOUNT_ID:?Set AWS_ACCOUNT_ID in production.env}"
export AWS_PROFILE AWS_REGION="${AWS_REGION:-ap-south-1}" AWS_PAGER=""
STACK="${STACK_NAME:-innotech}"

check_account() {
  local actual
  actual="$(aws sts get-caller-identity --query Account --output text)"
  if [ "$actual" != "$AWS_ACCOUNT_ID" ]; then
    echo "AWS profile '$AWS_PROFILE' is account $actual, but production.env says $AWS_ACCOUNT_ID. Stopping." >&2
    exit 1
  fi
  echo "AWS account $actual ($AWS_PROFILE), region $AWS_REGION, stack $STACK"
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

deploy_api() {
  : "${GOOGLE_CLIENT_IDS:?Set GOOGLE_CLIENT_IDS in production.env}" "${SUPER_ADMIN_EMAILS:?Set SUPER_ADMIN_EMAILS in production.env}"
  local repo tag ops portal admin api_host
  check_dns "${PORTAL_EXTRA_HOSTS:-}" "${ADMIN_EXTRA_HOSTS:-}" "${API_EXTRA_HOSTS:-}"
  repo="$(output EcrRepository)"
  ops="$(output OpsBucket)"
  portal="${PORTAL_ORIGIN:-https://$(output PortalHost)}"
  admin="${ADMIN_ORIGIN:-https://$(output AdminHost)}"
  api_host="$(output ApiHost)${API_EXTRA_HOSTS:+, $API_EXTRA_HOSTS}"
  tag="$(git -C "$ROOT" rev-parse --short HEAD)$(git -C "$ROOT" diff --quiet HEAD -- server || echo "-dirty-$(date +%s)")"

  echo "Building API image $repo:$tag (linux/arm64)..."
  aws ecr get-login-password | docker login --username AWS --password-stdin "${repo%%/*}" >/dev/null
  docker buildx build --platform linux/arm64 -t "$repo:$tag" --push "$ROOT/server"

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

upload_site() {
  local app="$1" site="$2" ops
  ops="$(output OpsBucket)"
  # Hashed assets first, then pages, so a page never points at a missing file; the instance then mirrors the folder.
  aws s3 sync --quiet "$ROOT/$app/out/_next/static" "s3://$ops/sites/$site/_next/static"
  aws s3 sync --quiet "$ROOT/$app/out" "s3://$ops/sites/$site" --delete
  aws s3 cp --quiet "$DEPLOY_DIR/remote/sync-sites.sh" "s3://$ops/release/sync-sites.sh"
  remote "aws s3 cp --quiet s3://$ops/release/sync-sites.sh /opt/innotech/sync-sites.sh && chmod 700 /opt/innotech/sync-sites.sh && /opt/innotech/sync-sites.sh $site"
}

deploy_sites() {
  : "${GOOGLE_CLIENT_IDS:?Set GOOGLE_CLIENT_IDS in production.env}"
  local api_url="${API_URL:-https://$(output ApiHost)}"
  build_site client "$api_url"
  build_site admin-panel "$api_url"
  upload_site client portal
  upload_site admin-panel admin
  echo "Portal: https://$(output PortalHost)"
  echo "Admin:  https://$(output AdminHost)"
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
  api) deploy_api ;;
  sites) deploy_sites ;;
  all) deploy_stack && deploy_api && deploy_sites ;;
  status) status ;;
  logs) remote "cd /opt/innotech && docker compose logs --tail ${2:-100} api caddy" ;;
  backup) remote "/opt/innotech/backup.sh" ;;
  shell) aws ssm start-session --target "$(output InstanceId)" ;;
  destroy) destroy ;;
  *) sed -n '2,15p' "$0"; exit 1 ;;
esac
