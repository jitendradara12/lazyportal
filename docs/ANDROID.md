# Android App (Capacitor)

Capacitor-based Android wrapper running the hosted web bundle with native HTTP transport and sandboxed official portal integration.

## Prerequisites

- Node 20+ and JDK 21.
- Android SDK with API 36 platform and build-tools (`ANDROID_HOME` or `local.properties` with `sdk.dir`).
- Targets: `minSdk 24 / compileSdk 36 / targetSdk 36`.

## Commands

Run from repo root:

```sh
npm run cap:assets   # Regenerate launcher icons + splash from packages/web/public
npm run cap:sync     # Build web bundle and sync native assets/policies into android/
npm run android:apk  # Build debug APK (cap:sync + ./gradlew assembleDebug)
npm run cap:open     # Open android/ in Android Studio
npm test             # Run core + web + proxy tests (no Android toolchain needed)
```

## API Routing

The app loads the production deployment (`server.url` in `capacitor.config.json`). Normal web updates deploy live without reinstalling the APK.

| Build | `BASE_URL` | Resolved by |
|---|---|---|
| `npm run dev`, browser deployment | `/api` (same-origin) | Vite proxy / Vercel rewrite |
| Android with `PortalHttp` | Direct native transport to JUET | `PortalHttpPlugin` |
| Older APK / unreviewed read | `https://lazyportal-tan.vercel.app/api` | `packages/web/src/lib/apiBase.js` |
| Fork / preview | `VITE_API_BASE` (web), `VITE_NATIVE_API_BASE` (app) | Environment override |

Transport configuration switches:
- `VITE_API_TRANSPORT`: `auto` (default; use native transport where supported) or `proxy` (force hosted proxy).
- `VITE_ATTENDANCE_QUOTA`: `auto` (follows transport), `on`, or `off`.

Compatibility invariant: `server.url` in `capacitor.config.json` must match `WEBVIEW_ORIGIN` in `shared/cors.js`.

## Native Features

- **Direct HTTP Transport (`PortalHttp`)**: Main API reads bypass the proxy and travel directly to JUET with full TLS validation, avoiding proxy rate limits and quotas. Disallowed endpoints or older APKs fall back cleanly to the proxy.
- **Official Student Portal View**: More → **Official student portal** opens an isolated, read-only WebView (`https://official.lazyportal.invalid`). HTML and approved reads communicate directly with JUET. Session and storage remain strictly in memory; no credentials or student responses are stored on disk.
- **JUET TLS Chain Repair**: JUET's server omits its intermediate certificate. `PortalTls` injects the bundled GoDaddy G2 intermediate (`shared/portal-intermediate.pem`) into system trust validation for JUET connections only. System root and hostname validation remain fully enforced.
- **System Integrations**:
  - `NativeInteractions`: Intercepts system Back navigation to close overlays before leaving tabs; triggers light haptics for user actions.
  - `ExamCalendar`: Exports exams to Android's native calendar via `ACTION_INSERT` or saves `.ics` files via the system document picker without requesting calendar permissions.

## Release Build & Signing

```sh
cd android
./gradlew assembleRelease
```

CI builds signed release APKs on git tags (`v*`). Tagged releases require these GitHub repository secrets:

- `KEYSTORE_BASE64`: Base64-encoded release keystore (`base64 < android/app/release.keystore | tr -d '\n'`)
- `KEYSTORE_PASSWORD`: Keystore password
- `KEY_ALIAS`: Key alias (`lazyportal`)
- `KEY_PASSWORD`: Key password

### Publishing updates

Push a new version tag, for example:

```sh
git tag v1.0.4
git push origin v1.0.4
```

Use a new tag for each release. CI runs the web and Android checks, builds `app-release.apk` with the existing signing key, and publishes it with download links in the release notes. The tag sets Android's version name; CI advances its version code automatically. Keep the same package ID and signing keystore so Android can update the installed app without uninstalling it.

The permanent Android download link is:

```text
https://github.com/jitendradara12/lazyportal/releases/latest/download/app-release.apk
```

You can also share [lazyportal-tan.vercel.app/download](https://lazyportal-tan.vercel.app/download). Vercel temporarily redirects it to the same GitHub URL, without proxying the APK or requiring a version edit. Keep the APK asset named `app-release.apk` on every stable release. GitHub's latest release excludes drafts and prereleases; prerelease notes use that tag's APK URL instead.

In the Android app, **More** checks GitHub's public latest-release API once per page load. `NativeInteractions.getAppVersion` reads the installed package's version name, independently of the hosted website. When a newer stable release with `app-release.apk` exists, the row shows **Update 1.0.3 → 1.0.4** and downloads that exact release. Equal or newer installed versions show **App up to date**. Release tags should use numeric versions such as `v1.0.4`.

The check has an eight-second timeout. Offline, rate-limited, or malformed responses keep the manual **Download latest APK** fallback. No GitHub token, polling, or update service is needed. Older APKs without the version method also keep that fallback; users need one native update before installed-version detection works.

Downloads open in the system browser. Open the downloaded file and approve Android's update prompt. Android may first ask you to allow installations from that browser.

The app loads the hosted website, so deploying this link makes it available to existing installed apps without an APK update. Most UI changes still arrive through normal web deployments. Publish an APK when native code, permissions, or the Android wrapper changes. Deploy the web changes to activate `/download`; no redirect edits are needed for later releases.

Generate a release keystore with:

```sh
keytool -genkeypair -v \
  -keystore android/app/release.keystore \
  -alias lazyportal -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass 'choose-a-strong-store-password' \
  -keypass 'choose-a-strong-key-password' \
  -dname "CN=JUET Portal, O=Lazyportal, C=IN"
```

## Live Reload (Dev)

```sh
# Terminal 1: run dev server accessible on LAN IP
npm --workspace @juet/web run dev -- --host

# Update capacitor.config.json temporarily:
#   "server": { "url": "http://<YOUR_LAN_IP>:5173", "cleartext": true }
VITE_NATIVE_API_BASE=/api npm run cap:sync
```

## Troubleshooting

| Symptom | Cause / Fix |
|---|---|
| Blank screen on launch | Device offline before cache warmup or deployment URL unreachable. |
| CORS error on every request | `WEBVIEW_ORIGIN` in `shared/cors.js` does not match `server.url` in `capacitor.config.json`. |
| Requests fail with `NETWORK_ERROR` | Device offline, or proxy URL in `apiBase.js` is unreachable. |
| Gradle cannot find JDK / SDK | Ensure `JAVA_HOME` points to JDK 21 and `ANDROID_HOME` points to the Android SDK. |
| Splash screen shows Capacitor logo | Run `npm run cap:assets` to regenerate brand assets. |
