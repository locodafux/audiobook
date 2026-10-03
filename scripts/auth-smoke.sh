#!/usr/bin/env bash
# End-to-end sign-in check against the LOCAL Supabase stack only (`supabase start` first).
# Proves: stranger refused, invited member gets an email with link + code, code signs in,
# an active member sees published books, a revoked member loses data and refresh.
set -euo pipefail
cd "$(dirname "$0")/.."

eval "$(supabase status -o env | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=')"
case "$API_URL" in http://127.0.0.1:*|http://localhost:*) ;; *) echo "refusing: not a local stack"; exit 1;; esac
MAIL=http://127.0.0.1:54324/api/v1
EMAIL="smoke-$RANDOM@example.test"
STRANGER="stranger-$RANDOM@example.test"
j() { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)"; }
call() { curl -s -X "$1" "$API_URL$2" -H "apikey: ${KEY:-$ANON_KEY}" -H "authorization: Bearer ${BEARER:-${KEY:-$ANON_KEY}}" -H 'content-type: application/json' ${3:+-d "$3"}; }
ok() { echo "ok: $1"; }
fail() { echo "FAIL: $1"; exit 1; }

# 1. stranger is refused and gets no email
r=$(call POST /auth/v1/otp "{\"email\":\"$STRANGER\"}")
[ "$(echo "$r" | j "d.get('error_code')")" = signup_disabled ] || fail "stranger not refused: $r"
ok "stranger refused (error_code=signup_disabled)"

# 2. admin invite: auth user without mail + members row + a published book with a ready chapter
uid=$(KEY=$SERVICE_ROLE_KEY call POST /auth/v1/admin/users "{\"email\":\"$EMAIL\",\"email_confirm\":true}" | j "d['id']")
KEY=$SERVICE_ROLE_KEY call POST /rest/v1/members "{\"user_id\":\"$uid\",\"email\":\"$EMAIL\",\"display_name\":\"Smoke\",\"invited_by\":\"script\"}" >/dev/null
KEY=$SERVICE_ROLE_KEY call POST /rest/v1/books '{"id":"smoke","title":"Smoke book","status":"published"}' >/dev/null || true
KEY=$SERVICE_ROLE_KEY call POST /rest/v1/chapters '{"book_id":"smoke","n":1,"title":"One","status":"ready"}' >/dev/null || true
ok "invited $EMAIL"

# 3. invited member asks for a code; the email carries link + 6-digit code
curl -s -X DELETE "$MAIL/messages" >/dev/null
call POST /auth/v1/otp "{\"email\":\"$EMAIL\"}" >/dev/null
sleep 2
id=$(curl -s "$MAIL/messages" | j "d['messages'][0]['ID']")
html=$(curl -s "$MAIL/message/$id" | j "d['HTML']")
code=$(echo "$html" | grep -oE '>[0-9]{6}<' | tr -d '<>')
echo "$html" | grep -q 'auth/v1/verify' || fail "email has no sign-in link"
[ -n "$code" ] || fail "email has no 6-digit code"
ok "email has link and code"

# 4. code signs in; wrong code does not
r=$(call POST /auth/v1/verify "{\"type\":\"email\",\"email\":\"$EMAIL\",\"token\":\"000000\"}")
[ "$(echo "$r" | j "d.get('error_code')")" = otp_expired ] || fail "wrong code accepted: $r"
session=$(call POST /auth/v1/verify "{\"type\":\"email\",\"email\":\"$EMAIL\",\"token\":\"$code\"}")
access=$(echo "$session" | j "d['access_token']"); refresh=$(echo "$session" | j "d['refresh_token']")
ok "code signs in"

# 5. active member sees the published book
n=$(BEARER=$access call GET "/rest/v1/books?select=id,title" | j "len(d)")
[ "$n" -ge 1 ] || fail "active member sees no books"
ok "active member sees $n published book(s)"

# 6. revoke: members.status + auth ban. Data disappears and refresh stops working.
KEY=$SERVICE_ROLE_KEY call PATCH "/rest/v1/members?user_id=eq.$uid" '{"status":"revoked","revoked_at":"now()"}' >/dev/null
KEY=$SERVICE_ROLE_KEY call PUT "/auth/v1/admin/users/$uid" '{"ban_duration":"876000h"}' >/dev/null
n=$(BEARER=$access call GET "/rest/v1/books?select=id" | j "len(d)")
[ "$n" = 0 ] || fail "revoked member still sees books"
ok "revoked member sees no books"
r=$(call POST "/auth/v1/token?grant_type=refresh_token" "{\"refresh_token\":\"$refresh\"}")
[ -z "$(echo "$r" | j "d.get('access_token') or ''")" ] || fail "revoked member can still refresh"
ok "revoked member cannot refresh"

# cleanup of smoke rows
KEY=$SERVICE_ROLE_KEY call DELETE "/rest/v1/books?id=eq.smoke" >/dev/null || true
KEY=$SERVICE_ROLE_KEY call DELETE "/auth/v1/admin/users/$uid" >/dev/null || true
echo "all good"
