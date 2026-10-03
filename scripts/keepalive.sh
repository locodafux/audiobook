#!/usr/bin/env bash
# Calls the database's ping() so the free Supabase project never looks idle. Used by .github/workflows/keepalive.yml.
# SUPABASE_URL and SUPABASE_ANON_KEY (public values) come from the environment; without them it does nothing and succeeds,
# so CI stays green until the accounts exist.
set -euo pipefail
if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_ANON_KEY:-}" ]; then
  echo "keep-alive skipped: SUPABASE_URL / SUPABASE_ANON_KEY not set"
  exit 0
fi
curl -fsS --max-time 30 --retry 2 -X POST "${SUPABASE_URL%/}/rest/v1/rpc/ping" \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY" -H 'content-type: application/json' -d '{}' >/dev/null
echo "keep-alive ok"
