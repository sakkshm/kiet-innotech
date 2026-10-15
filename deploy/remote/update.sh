#!/bin/bash
# Runs on the instance (as root, via SSM) for every API release:
#   ./update.sh <image tag>    release that image
#   ./update.sh --rollback     put the previous release back (after a failed check further on)
#
# A release only replaces the running API once every step before it has passed:
#   1. back up the database (checked, uploaded to S3);
#   2. restore that backup into a throwaway database and run the new migrations on it, checking no rows are lost;
#   3. run the migrations on the real database (one transaction: all or nothing);
#   4. start the new API and check it answers, directly and through Caddy.
# A failure in 1-3 leaves the running API untouched. A failure in 4 puts the previous release back.
# Migrations are never undone automatically: they must only add (CI rejects drops and renames), so the previous
# release keeps working on the migrated database.
set -Eeuo pipefail
cd "${INNOTECH_HOME:-/opt/innotech}"
source bootstrap.env
mkdir -p sites/portal sites/admin caddy
export AWS_REGION
RELEASE_FILES=(compose.yml caddy/Caddyfile config.env .env)

# Chained with && because callers use it in an `if`, where `set -e` does not apply.
start() {
  docker compose up -d --remove-orphans --wait --wait-timeout 180 &&
    # Caddy reads its mounted Caddyfile only at start, so apply changes to it explicitly.
    docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --force >/dev/null &&
    docker compose exec -T api python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=10).read().decode())" &&
    # The path visitors take: Caddy to the API over the internal network.
    docker compose exec -T caddy wget -qO- --timeout=10 http://api:8000/health >/dev/null
}

# Release files are kept twice: <file>.cur is the running release while a new one is tried (put back on failure),
# <file>.prev the release before the running one (put back by --rollback).
save_as() {
  for file in "${RELEASE_FILES[@]}"; do
    if [ -f "$file" ]; then cp -p "$file" "$file.$1"; fi
  done
}

restore_from() {
  for file in "${RELEASE_FILES[@]}"; do
    if [ -f "$file.$1" ]; then cp -p "$file.$1" "$file"; fi
  done
}

if [ "${1:-}" = "--rollback" ]; then
  [ -f .env.prev ] || { echo "No previous release to go back to." >&2; exit 1; }
  echo "Putting back $(sed -n 's/^API_IMAGE=//p' .env.prev)..."
  save_as failed
  restore_from prev
  start
  docker compose ps --format "table {{.Service}}\t{{.Status}}"
  exit 0
fi

TAG="${1:?usage: update.sh <image tag> | --rollback}"
IMAGE="$ECR_REPOSITORY:$TAG"

save_as cur
cleanup_rehearsal() {
  docker rm -f innotech-rehearsal-db >/dev/null 2>&1 || true
  docker network rm innotech-rehearsal >/dev/null 2>&1 || true
}
# Any failure before the new API starts leaves the old files in place for the next attempt.
trap 'cleanup_rehearsal; restore_from cur; rm -f .env.next; echo "Release $TAG stopped before switching; the running API is unchanged." >&2' ERR

aws s3 cp --quiet "s3://$OPS_BUCKET/release/compose.yml" compose.yml
aws s3 cp --quiet "s3://$OPS_BUCKET/release/Caddyfile" caddy/Caddyfile
aws s3 cp --quiet "s3://$OPS_BUCKET/release/config.env" config.env
aws s3 cp --quiet "s3://$OPS_BUCKET/release/backup.sh" backup.sh
aws s3 cp --quiet "s3://$OPS_BUCKET/release/sync-sites.sh" sync-sites.sh
chmod 700 backup.sh sync-sites.sh

# Secrets are created here once and never leave the instance.
if [ ! -f secrets.env ]; then
  umask 077
  echo "DB_PASSWORD=$(openssl rand -hex 24)" > secrets.env
  echo "SESSION_SECRET=$(openssl rand -base64 48 | tr -d '\n/+=')" >> secrets.env
fi
umask 077
{ cat config.env; echo; cat secrets.env; echo "API_IMAGE=$IMAGE"; } > .env.next
# The very first release has no running one; the database starts with the new settings.
[ -f .env ] || cp -p .env.next .env

aws ecr get-login-password | docker login --username AWS --password-stdin "${ECR_REPOSITORY%%/*}" >/dev/null
docker pull --quiet "$IMAGE" >/dev/null
docker compose up -d --wait db

# 1. Backup.
./backup.sh

# 2. Rehearsal on a copy.
COUNTS="SELECT string_agg(t || '=' || n, ' ' ORDER BY t) FROM (
  SELECT 'users' t, count(*) n FROM users UNION ALL SELECT 'profiles', count(*) FROM profiles UNION ALL
  SELECT 'teams', count(*) FROM teams UNION ALL SELECT 'team_members', count(*) FROM team_members UNION ALL
  SELECT 'invitations', count(*) FROM invitations UNION ALL SELECT 'admins', count(*) FROM admins) x"
cleanup_rehearsal
echo "Rehearsing the migrations on a copy of the backup..."
docker network create innotech-rehearsal >/dev/null
docker run -d --name innotech-rehearsal-db --network innotech-rehearsal --shm-size 128m \
  -e POSTGRES_USER=innotech -e POSTGRES_PASSWORD=rehearsal -e POSTGRES_DB=innotech postgres:16-alpine >/dev/null
for _ in $(seq 1 60); do
  # Over TCP: during its first start Postgres listens on the socket only, before it is really ready.
  docker exec innotech-rehearsal-db pg_isready -q -h 127.0.0.1 -U innotech && break
  sleep 2
done
docker exec -i innotech-rehearsal-db pg_restore -U innotech -d innotech --no-owner --exit-on-error < backup/last.dump
# A new database (first release) has nothing to count yet.
if [ "$(docker exec innotech-rehearsal-db psql -U innotech -d innotech -Atc "SELECT to_regclass('public.users') IS NOT NULL")" = t ]; then
  before="$(docker exec innotech-rehearsal-db psql -U innotech -d innotech -At -c "$COUNTS")"
else
  before=""
fi
docker run --rm --network innotech-rehearsal --env-file .env.next \
  -e DATABASE_URL=postgresql+psycopg://innotech:rehearsal@innotech-rehearsal-db:5432/innotech "$IMAGE" alembic upgrade head
after="$(docker exec innotech-rehearsal-db psql -U innotech -d innotech -At -c "$COUNTS")"
cleanup_rehearsal
if [ -n "$before" ] && [ "$before" != "$after" ]; then
  echo "The migrations changed row counts on the copy (before: $before; after: $after). Stopping." >&2
  false
fi
echo "Rehearsal passed: $after"

# 3. The real migration, with the new image; the running API is not touched yet.
mv .env.next .env
docker compose run --rm --no-deps api alembic upgrade head
trap - ERR

# 4. Switch, check, and go back on any failure.
echo "Starting $IMAGE..."
if ! start; then
  echo "The new API failed its checks." >&2
  docker compose logs --tail 50 api >&2 || true
  echo "Putting back $(sed -n 's/^API_IMAGE=//p' .env.cur)..." >&2
  restore_from cur
  start
  echo "Release $TAG was rolled back; the previous release is running." >&2
  exit 1
fi
for file in "${RELEASE_FILES[@]}"; do
  if [ -f "$file.cur" ]; then mv -f "$file.cur" "$file.prev"; fi
done
docker image prune -f >/dev/null

# Database dump to S3 every 15 minutes.
if command -v systemctl >/dev/null; then
  cat > /etc/systemd/system/innotech-backup.service <<UNIT
[Unit]
Description=InnoTech database backup to S3
[Service]
Type=oneshot
ExecStart=/opt/innotech/backup.sh
UNIT
  cat > /etc/systemd/system/innotech-backup.timer <<UNIT
[Unit]
Description=InnoTech database backup every 15 minutes
[Timer]
OnCalendar=*:0/15
Persistent=true
[Install]
WantedBy=timers.target
UNIT
  systemctl daemon-reload
  systemctl enable --now innotech-backup.timer >/dev/null
fi

docker compose ps --format "table {{.Service}}\t{{.Status}}"
echo "Released $TAG."
