#!/bin/bash
# Fails if a migration added or changed since <base commit> drops or renames a table or column in upgrade().
# A failed release is rolled back to the previous API image without undoing migrations, which only works while
# the old code still finds every table and column it uses. Such a change needs a manual, planned release instead.
#   ./check-migrations.sh <base commit>
set -euo pipefail
cd "$(dirname "$0")/.."
base="${1:?usage: check-migrations.sh <base commit>}"
status=0
for file in $(git diff --name-only --diff-filter=AM "$base" HEAD -- 'server/migrations/versions/*.py'); do
  found="$(awk '/^def upgrade/{u=1} /^def downgrade/{u=0} u' "$file" |
    grep -nEi 'drop_column|drop_table|rename_table|new_column_name|drop (column|table)|rename (column|to)' || true)"
  if [ -n "$found" ]; then
    echo "$file drops or renames something in upgrade():" >&2
    echo "$found" >&2
    status=1
  fi
done
[ "$status" = 0 ] && echo "Migrations since ${base:0:7}: only additive changes."
exit "$status"
