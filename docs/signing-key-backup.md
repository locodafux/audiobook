# Android signing key: backup and release notes

The release APK is signed with one keystore. Android only installs an update signed by the **same** key, so
if it is lost, every friend has to uninstall Hearthread (and lose their downloads) before installing again.

## Create it (once, before the first release)
```
keytool -genkeypair -v -keystore ~/hearthread-release.jks -alias hearthread \
  -keyalg RSA -keysize 4096 -validity 10000
```
Keep it **outside** the repo (`scripts/release.sh` refuses a keystore inside it). Note the keystore password,
alias and key password in your password manager.

## Back it up (do this the same day)
1. Copy `hearthread-release.jks` to two places that are not this Mac: the password manager's file attachment
   and an encrypted cloud or USB copy.
2. Store the three passwords and the alias next to it, not in a file beside the key.
3. Check the backup works: `keytool -list -keystore <backup copy>` asks for the password and prints the alias.
4. Never commit it, paste it in chat, or attach it to a GitHub release. `.gitignore` already blocks `*.jks`/`*.keystore`.

## Releasing
1. Raise `expo.android.versionCode` (and `version`) in `app/app.json`; the app only offers a newer code.
2. Put the config in the git-ignored `.env.release` at the repo root (names only; values are yours):
   `HEARTHREAD_KEYSTORE`, `HEARTHREAD_KEYSTORE_PASSWORD`, `HEARTHREAD_KEY_ALIAS`, `HEARTHREAD_KEY_PASSWORD`,
   `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
3. `scripts/release.sh --dry-run` to check the config, then `scripts/release.sh`. It needs the Android SDK
   (build-tools with `apksigner`), `gh` signed in, and builds an arm64 APK named `hearthread-<versionCode>.apk`.
4. It replaces the single APK on the GitHub release tagged `latest`. Installed apps show "Update available"
   on their next launch. Smoke-test on a phone before releasing.

## Keep-alive
`.github/workflows/keepalive.yml` pings the database every 3 days. Add `SUPABASE_URL` and `SUPABASE_ANON_KEY`
(both public values) as repository secrets or variables once the project exists; until then it does nothing and passes.
GitHub disables scheduled workflows after 60 days without repo activity: re-enable it from the Actions tab if that happens.
