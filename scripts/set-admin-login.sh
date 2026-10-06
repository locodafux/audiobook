#!/usr/bin/env bash
# One time: give the admin (members.is_admin, username `leo` after the username_login migration)
# a username login. Moves their Auth user to the internal address leo@users.hearthread.invalid
# and sets the password you type. Nothing is saved or printed; keys are read from the prompt.
set -euo pipefail
read -r -p "Project URL (https://<ref>.supabase.co): " URL
read -r -s -p "Service-role key: " KEY; echo
read -r -s -p "New admin password (8+ chars): " PASS; echo
[ "${#PASS}" -ge 8 ] || { echo "password too short"; exit 1; }
api() { curl -fsS "$@" -H "apikey: $KEY" -H "authorization: Bearer $KEY" -H 'content-type: application/json'; }
uid=$(api "$URL/rest/v1/members?is_admin=eq.true&username=eq.leo&select=user_id" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d[0]['user_id'])")
body=$(PASS="$PASS" python3 -c "import os,json;print(json.dumps({'email':'leo@users.hearthread.invalid','password':os.environ['PASS'],'email_confirm':True}))")
api -X PUT "$URL/auth/v1/admin/users/$uid" -d "$body" >/dev/null
echo "done: log in as leo"
