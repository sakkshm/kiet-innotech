#!/bin/bash
# Switches the site Caddy serves to the build in the ops bucket:
#   ./sync-sites.sh portal|admin              copy the new build into a new release folder, check it, then switch
#   ./sync-sites.sh --rollback portal|admin   switch back to the previous release
# sites/<site> is a symlink to the live release, replaced in one atomic rename: visitors see the old site or the
# new one, never a half-copied folder.
set -euo pipefail
cd "${INNOTECH_HOME:-/opt/innotech}"
source bootstrap.env
export AWS_REGION

switch_to() {
  ln -sfn ".releases/$site/$1" "sites/.$site.link"
  mv -Tf "sites/.$site.link" "sites/$site"
}

if [ "${1:-}" = "--rollback" ]; then
  site="${2:?usage: sync-sites.sh --rollback portal|admin}"
  releases="sites/.releases/$site"
  previous="$(cat "$releases/previous" 2>/dev/null || true)"
  [ -n "$previous" ] && [ -d "$releases/$previous" ] || { echo "No previous $site release to go back to." >&2; exit 1; }
  failed="$(basename "$(readlink "sites/$site")")"
  switch_to "$previous"
  echo "$failed" > "$releases/previous"
  echo "$site: previous release $previous is live again"
  exit 0
fi

site="${1:?usage: sync-sites.sh portal|admin}"
releases="sites/.releases/$site"
mkdir -p "$releases"
# First run on a plain folder: make it the first release (Caddy briefly serves nothing while it moves).
if [ -d "sites/$site" ] && [ ! -L "sites/$site" ]; then
  mv "sites/$site" "$releases/00000000-000000"
  switch_to 00000000-000000
fi
current="$(basename "$(readlink "sites/$site" 2>/dev/null || echo none)")"
new="$(mktemp -d "$releases/$(date -u +%Y%m%d-%H%M%S)-XXXX")"
chmod 755 "$new"
name="$(basename "$new")"
# Start from the live copy so only changed files are downloaded.
if [ -d "$releases/$current" ]; then cp -a "$releases/$current/." "$new/"; fi
# --exact-timestamps: rebuilt pages often keep the same size (only hashed file names change), and the default
# size-and-newer check then silently keeps the old copy.
aws s3 sync --quiet --delete --exact-timestamps "s3://$OPS_BUCKET/sites/$site" "$new"
for page in index.html 404.html; do
  [ -s "$new/$page" ] || { rm -rf "$new"; echo "The new $site build has no $page. The live site is unchanged." >&2; exit 1; }
done
# Keep the live release's hashed scripts, so a page opened before the switch can still load the rest of itself.
# shortcut: old hashed files carry forward release to release (a few MB each), prune them if the disk ever fills.
if [ -d "$releases/$current/_next/static" ]; then
  mkdir -p "$new/_next/static"
  cp -an "$releases/$current/_next/static/." "$new/_next/static/"
fi
switch_to "$name"
if [ -d "$releases/$current" ]; then echo "$current" > "$releases/previous"; fi
# Keep the live release and the two before it.
find "$releases" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort | head -n -3 | while read -r old; do
  if [ "$old" != "$current" ] && [ "$old" != "$name" ]; then rm -rf "${releases:?}/$old"; fi
done
echo "$site: $(find -L "sites/$site" -type f | wc -l) files (release $name)"
