#!/bin/bash
# Dumps the database to S3 (custom format, restore with pg_restore). Run by a systemd timer every 15 minutes and at
# the start of every API release. The dump is checked before upload and kept as backup/last.dump, which update.sh
# restores into a throwaway database to rehearse migrations.
set -euo pipefail
cd "${INNOTECH_HOME:-/opt/innotech}"
source bootstrap.env
export AWS_REGION
mkdir -p backup
# The timer and a release can start a backup at the same moment; one waits for the other.
exec 9> backup/.lock
flock 9

key="backups/db/$(date -u +%Y/%m/%d/%H%M%S).dump"
docker compose exec -T db pg_dump -U innotech -Fc innotech > backup/next.dump
# A readable archive, not an empty or cut-off file, holding the users table's data (unless the database is new).
listing="$(docker compose exec -T db pg_restore -l < backup/next.dump)" || listing=""
has_users="$(docker compose exec -T db psql -U innotech -d innotech -Atc "SELECT to_regclass('public.users') IS NOT NULL")"
if [ -z "$listing" ] || { [ "$has_users" = t ] && ! grep -q "TABLE DATA public users " <<< "$listing"; }; then
  echo "The database dump is not readable. Nothing was uploaded." >&2
  exit 1
fi
aws s3 cp --quiet backup/next.dump "s3://$OPS_BUCKET/$key"
mv backup/next.dump backup/last.dump
echo "Backed up to s3://$OPS_BUCKET/$key ($(du -h backup/last.dump | cut -f1))"
