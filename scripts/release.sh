#!/usr/bin/env bash
# Build the signed arm64 release APK on this Mac and publish it as the only asset of the rolling
# GitHub release tagged `latest`. The app's update banner reads that asset's name (hearthread-<versionCode>.apk).
#
#   scripts/release.sh [--dry-run]
#
# Bump expo.android.versionCode in app/app.json first: the app only offers an APK newer than itself.
# Config comes from the git-ignored `.env.release` (or the file named by HEARTHREAD_RELEASE_ENV), never the repo:
#   HEARTHREAD_KEYSTORE            path to the keystore, OUTSIDE this repo (back it up: docs/signing-key-backup.md)
#   HEARTHREAD_KEYSTORE_PASSWORD, HEARTHREAD_KEY_ALIAS, HEARTHREAD_KEY_PASSWORD
#   EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY   public values baked into the app
# --dry-run checks the config and prints the plan; it builds and publishes nothing.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd -P)
cd "$ROOT"

DRY=0
case "${1:-}" in --dry-run) DRY=1 ;; "") ;; *) echo "usage: $0 [--dry-run]" >&2; exit 2 ;; esac

ENV_FILE=${HEARTHREAD_RELEASE_ENV:-.env.release}
if [ -f "$ENV_FILE" ]; then set -a; . "$ENV_FILE"; set +a; fi

missing=()
for v in HEARTHREAD_KEYSTORE HEARTHREAD_KEYSTORE_PASSWORD HEARTHREAD_KEY_ALIAS HEARTHREAD_KEY_PASSWORD EXPO_PUBLIC_SUPABASE_URL EXPO_PUBLIC_SUPABASE_ANON_KEY; do
  [ -n "${!v:-}" ] || missing+=("$v")
done
if [ ${#missing[@]} -gt 0 ]; then echo "missing in $ENV_FILE or the environment: ${missing[*]}" >&2; exit 1; fi
[ -f "$HEARTHREAD_KEYSTORE" ] || { echo "keystore not found: $HEARTHREAD_KEYSTORE" >&2; exit 1; }
KS=$(cd "$(dirname "$HEARTHREAD_KEYSTORE")" && pwd -P)/$(basename "$HEARTHREAD_KEYSTORE")
case "$KS" in "$ROOT"/*) echo "refusing: keystore is inside the repo; keep it outside" >&2; exit 1 ;; esac

CODE=$(python3 -c "import json;print(json.load(open('app/app.json'))['expo']['android']['versionCode'])")
ASSET="hearthread-$CODE.apk"
OUT="$ROOT/app/android/app/build/outputs/apk/release"
GH=${GH:-gh}

echo "release plan: versionCode $CODE -> asset $ASSET on release 'latest'"
echo "  1. npm ci, expo prebuild (android), gradle assembleRelease (arm64-v8a)"
echo "  2. apksigner sign + verify with the keystore outside the repo"
echo "  3. upload $ASSET to 'latest' (create it if missing), then delete the older assets"
if [ "$DRY" = 1 ]; then echo "dry run: nothing built or published"; exit 0; fi

# Refuse to publish something the app would not treat as newer.
live=$("$GH" release view latest --json assets --jq '.assets[].name' 2>/dev/null | sed -n 's/^hearthread-\([0-9]*\)\.apk$/\1/p' | sort -n | tail -1 || true)
if [ -n "$live" ] && [ "$CODE" -le "$live" ]; then echo "refusing: latest already has versionCode $live; bump app/app.json" >&2; exit 1; fi

(cd app && npm ci && npx expo prebuild --platform android --clean --no-install)
(cd app/android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a)

APKSIGNER=$(ls -d "${ANDROID_HOME:-$HOME/Library/Android/sdk}"/build-tools/*/apksigner | sort -V | tail -1)
UNSIGNED=$(ls "$OUT"/*.apk | head -1)
cp "$UNSIGNED" "$OUT/$ASSET"
KS_PASS=$HEARTHREAD_KEYSTORE_PASSWORD KEY_PASS=$HEARTHREAD_KEY_PASSWORD "$APKSIGNER" sign \
  --ks "$KS" --ks-key-alias "$HEARTHREAD_KEY_ALIAS" --ks-pass env:KS_PASS --key-pass env:KEY_PASS "$OUT/$ASSET"
"$APKSIGNER" verify "$OUT/$ASSET"

"$GH" release view latest >/dev/null 2>&1 || "$GH" release create latest --target main --title "Latest Hearthread APK" --notes "Rolling release. Install the attached APK."
"$GH" release upload latest "$OUT/$ASSET" --clobber
"$GH" release view latest --json assets --jq '.assets[].name' | while read -r name; do
  [ "$name" = "$ASSET" ] || "$GH" release delete-asset latest "$name" --yes
done
echo "published $ASSET"
