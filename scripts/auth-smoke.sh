#!/usr/bin/env bash
# End-to-end sign-in check against the LOCAL Supabase stack only (`supabase start` first).
# Proves: public sign-up is closed, a username/password member starts pending and sees nothing,
# approval opens the data, revoking closes it again.
# Creates the user the way the `accounts` function does: admin API, email pre-confirmed, pending row.
set -euo pipefail
cd "$(dirname "$0")/.."

eval "$(supabase status -o env | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=')"
case "$API_URL" in http://127.0.0.1:*|http://localhost:*) ;; *) echo "refusing: not a local stack"; exit 1;; esac
NAME="smoke_$RANDOM"
EMAIL="$NAME@users.hearthread.invalid"
PASS="smoke-pass-$RANDOM"
j() { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)"; }
call() { curl -s -X "$1" "$API_URL$2" -H "apikey: ${KEY:-$ANON_KEY}" -H "authorization: Bearer ${BEARER:-${KEY:-$ANON_KEY}}" -H 'content-type: application/json' ${3:+-d "$3"}; }
ok() { echo "ok: $1"; }
fail() { echo "FAIL: $1"; exit 1; }
books() { BEARER=$1 call GET "/rest/v1/books?select=id" | j "len(d)"; }

# 1. the public sign-up endpoint is closed
r=$(call POST /auth/v1/signup "{\"email\":\"x$RANDOM@users.hearthread.invalid\",\"password\":\"$PASS\"}")
[ "$(echo "$r" | j "d.get('error_code')")" = signup_disabled ] || fail "public sign-up is open: $r"
ok "public sign-up refused (error_code=signup_disabled)"

# 2. a published book, then a new account: confirmed email, pending member row (the default status)
KEY=$SERVICE_ROLE_KEY call POST /rest/v1/books '{"id":"smoke","title":"Smoke book","status":"published"}' >/dev/null || true
KEY=$SERVICE_ROLE_KEY call POST /rest/v1/chapters '{"book_id":"smoke","n":1,"title":"One","status":"ready"}' >/dev/null || true
uid=$(KEY=$SERVICE_ROLE_KEY call POST /auth/v1/admin/users "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"email_confirm\":true}" | j "d['id']")
KEY=$SERVICE_ROLE_KEY call POST /rest/v1/members "{\"user_id\":\"$uid\",\"email\":\"$EMAIL\",\"username\":\"$NAME\",\"display_name\":\"$NAME\"}" >/dev/null
st=$(KEY=$SERVICE_ROLE_KEY call GET "/rest/v1/members?user_id=eq.$uid&select=status" | j "d[0]['status']")
[ "$st" = pending ] || fail "new member is not pending: $st"
ok "registered $NAME as pending"

# 3. username + password signs in, but pending sees nothing
access=$(call POST "/auth/v1/token?grant_type=password" "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" | j "d['access_token']")
r=$(call POST "/auth/v1/token?grant_type=password" "{\"email\":\"$EMAIL\",\"password\":\"wrong-$PASS\"}")
[ "$(echo "$r" | j "d.get('error_code')")" = invalid_credentials ] || fail "wrong password accepted: $r"
[ "$(books "$access")" = 0 ] || fail "pending member sees books"
ok "pending member signs in and sees no books; wrong password refused"

# 4. approve: the same session now sees the published book
KEY=$SERVICE_ROLE_KEY call PATCH "/rest/v1/members?user_id=eq.$uid" '{"status":"active"}' >/dev/null
[ "$(books "$access")" -ge 1 ] || fail "approved member sees no books"
ok "approved member sees the published book"

# 5. reject / revoke closes it again
KEY=$SERVICE_ROLE_KEY call PATCH "/rest/v1/members?user_id=eq.$uid" '{"status":"revoked","revoked_at":"now()"}' >/dev/null
[ "$(books "$access")" = 0 ] || fail "revoked member still sees books"
ok "revoked member sees no books"

# cleanup of smoke rows
KEY=$SERVICE_ROLE_KEY call DELETE "/rest/v1/books?id=eq.smoke" >/dev/null || true
KEY=$SERVICE_ROLE_KEY call DELETE "/auth/v1/admin/users/$uid" >/dev/null || true
echo "all good"
