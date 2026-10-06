#!/usr/bin/env bash
# Checks release.sh --dry-run and keepalive.sh without building, publishing or touching the network.
set -euo pipefail
cd "$(dirname "$0")/.."
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
touch "$T/key.jks"
cfg() { printf 'HEARTHREAD_KEYSTORE=%s\nHEARTHREAD_KEYSTORE_PASSWORD=s3cretpw\nHEARTHREAD_KEY_ALIAS=a\nHEARTHREAD_KEY_PASSWORD=s3cretkp\nEXPO_PUBLIC_SUPABASE_URL=http://x\nEXPO_PUBLIC_SUPABASE_ANON_KEY=k\n' "$1" > "$T/env"; }
fail() { echo "FAIL: $1"; exit 1; }

# no config: refuses and names the missing variables
: > "$T/empty"
if out=$(HEARTHREAD_RELEASE_ENV="$T/empty" env -u HEARTHREAD_KEYSTORE scripts/release.sh --dry-run 2>&1); then fail "ran without config"; fi
case "$out" in *HEARTHREAD_KEYSTORE_PASSWORD*) ;; *) fail "missing vars not named: $out" ;; esac

# keystore inside the repo: refused
mkdir -p tmp; touch tmp/in-repo.jks; cfg "$PWD/tmp/in-repo.jks"
if HEARTHREAD_RELEASE_ENV="$T/env" scripts/release.sh --dry-run >/dev/null 2>&1; then rm -f tmp/in-repo.jks; fail "accepted an in-repo keystore"; fi
rm -f tmp/in-repo.jks

# good config: prints the plan, never the passwords
cfg "$T/key.jks"
out=$(HEARTHREAD_RELEASE_ENV="$T/env" scripts/release.sh --dry-run 2>&1) || fail "dry run failed: $out"
case "$out" in *"hearthread-1.apk"*"dry run: nothing built"*) ;; *) fail "no plan: $out" ;; esac
case "$out" in *s3cretpw*|*s3cretkp*) fail "password leaked" ;; esac

# keep-alive: no secrets = quiet success; unreachable URL = failure
env -u SUPABASE_URL -u SUPABASE_ANON_KEY scripts/keepalive.sh | grep -q skipped || fail "keepalive did not skip"
if SUPABASE_URL=http://127.0.0.1:9 SUPABASE_ANON_KEY=k scripts/keepalive.sh >/dev/null 2>&1; then fail "keepalive hid an error"; fi
echo "ok"
