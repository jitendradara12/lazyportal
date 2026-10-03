# Android app (Capacitor)

The web app ships to Android inside Capacitor's WebView. The shell bundles the
same `packages/web/dist` build, so the dashboard is identical to the browser
one; only where API traffic goes differs (see [API routing](#api-routing)).

| Piece | Location |
|---|---|
| Capacitor config | `capacitor.config.json` (repo root) |
| Native project (checked in) | `android/` |
| Synced web bundle (generated, git-ignored) | `android/app/src/main/assets/public/` |
| Launcher icons + splash (generated, checked in) | `android/app/src/main/res/mipmap-*/`, `drawable*/splash.png` |
| Icon/splash generator | `scripts/generate-app-assets.mjs` |
| CI (tests, debug APK, tagged releases) | `.github/workflows/build-apk.yml` |

App id `com.lazyportal.juet`, name `JUET Portal` — both from
`capacitor.config.json`; `npx cap sync` writes them into the native project.

## Prerequisites

- Node 20+ (the workspace already needs it) and JDK 21 (`sourceCompatibility` is
  set to 21 by `android/app/capacitor.build.gradle`).
- Android SDK with API 36 platform + build-tools, and `ANDROID_HOME` (or
  `local.properties` with `sdk.dir`) pointing at it. Easiest path: open
  `android/` once in Android Studio. Capacitor's template targets
  `minSdk 24 / compileSdk 36 / targetSdk 36` (see `android/variables.gradle`).

## Commands

Run from the repo root.

```sh
npm install          # once

npm run cap:assets   # regenerate launcher icons + splash from packages/web/public
npm run cap:sync     # build the web bundle and copy it into android/  ← run after every web change
npm run android:apk  # cap:sync + ./gradlew assembleDebug
npm run cap:open     # open android/ in Android Studio
npm test             # core + web + proxy tests (no Android toolchain needed)
```

`android/` is checked in (Capacitor's template plus this repo's icons and
colours). Edit native files in place — `cap sync` overwrites only the generated
files (bundle, `capacitor.config.json`, `capacitor.settings.gradle`,
`capacitor-cordova-android-plugins/`).

## API routing

The portal 403s any `Origin`/`Referer` that is not its own, so browsers must go
through a proxy on the same origin as the page. The native shell loads the
production deployment (`https://lazyportal-tan.vercel.app`) via `server.url` in
`capacitor.config.json`. This provides instant daily updates without requiring
users to reinstall the APK.

| Build | `BASE_URL` | Resolved by |
|---|---|---|
| `npm run dev`, browser deployment | `/api` (same-origin) | Vite proxy / Vercel rewrite |
| Capacitor app | `https://lazyportal-tan.vercel.app/api` | `packages/web/src/lib/apiBase.js` |
| Fork / preview | `VITE_API_BASE` (web), `VITE_NATIVE_API_BASE` (app) | same file |

`shared/cors.js` allows `WEBVIEW_ORIGIN` (`https://lazyportal-tan.vercel.app`). Two
things must stay in sync:

1. `WEBVIEW_ORIGIN` in `shared/cors.js` ↔ `server.url`
   in `capacitor.config.json` (a test asserts this).
2. `PROD_API_BASE` in `packages/web/src/lib/apiBase.js` ↔ the deployed proxy
   URL. Changing the deployment URL means updating this constant and
   redeploying.

## Icons and splash

`npm run cap:assets` writes straight into `android/app/src/main/res/`:

- `mipmap-*/ic_launcher.png` — legacy launcher icon (the PWA icon).
- `mipmap-*/ic_launcher_round.png` — circular variant.
- `mipmap-*/ic_launcher_foreground.png` — white glyph for the adaptive icon
  (`mipmap-anydpi-v26/ic_launcher.xml`), drawn with ~25% padding so it survives
  every launcher mask.
- `drawable*/splash.png` — brand navy with the centred glyph, used by the
  launch theme.

The glyph is un-mixed from `public/icon-maskable-512.png` (white on `#1a237e`)
rather than re-rendered from SVG text, so it needs no fonts and produces
byte-identical output everywhere — unlike `@capacitor/assets`, whose old sharp
downloads libvips from GitHub during install. Sources of truth remain
`packages/web/public/icon.svg` / `icon-maskable.svg`; change those, then run
`npm --workspace @juet/web run generate-icons` followed by `npm run cap:assets`.

## Session storage

The shell keeps the session in the WebView's `localStorage` (keys prefixed
`juet.portal.`), exactly like the browser build, and the saved password when the
user ticks "Remember me". `android:allowBackup="false"` in
`app/src/main/AndroidManifest.xml` keeps that out of cloud and device-transfer
backups; on a new device the user logs in again.

## Release build

```sh
cd android
./gradlew assembleRelease          # or: ./gradlew bundleRelease for an AAB
```

`app/build.gradle` keeps `versionCode` above previously shipped APKs by taking
the maximum of the full Git commit count and the new workflow run number plus
the legacy `android.yml` high-water mark (13). CI fetches full history and passes
the run number through `VERSION_CODE_RUN`, so this workflow rename cannot cause
Android to reject an update. On a `v*` tag, CI also sets `versionName`
from the tag (without the leading `v`). The APK workflow always uploads
`app-debug.apk` as a run artifact. For version tags it additionally builds a
signed `app-release.apk` and creates or updates a published GitHub Release with
that APK attached.

Release-tag builds require a persistent signing key; CI deliberately fails
rather than publishing an APK signed by a temporary key that cannot receive
future updates. To create a keystore, choose strong, unique passwords and keep
them private:

```sh
keytool -genkeypair -v \
  -keystore android/app/release.keystore \
  -alias lazyportal -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass 'choose-a-strong-store-password' \
  -keypass 'choose-a-strong-key-password' \
  -dname "CN=JUET Portal, O=Lazyportal, C=IN"
```

Add these repository Actions secrets before pushing a version tag:

- `KEYSTORE_BASE64` — output of `base64 < android/app/release.keystore | tr -d '\n'`
- `KEYSTORE_PASSWORD` — the keystore password
- `KEY_ALIAS` — the key alias (for the command above, `lazyportal`)
- `KEY_PASSWORD` — the key password

The keystore is ignored by Git; never commit it or share the encoded value. The
workflow uses Java 21 because the Capacitor Android project compiles with Java 21.
Never distribute debug builds to users; release builds prevent Play Protect
debug blocks and permit seamless updates without "App not installed" errors.


## Before merging a native change (device QA)

CI only compiles the APK; it never boots the WebView. Manual signoff on a
physical device or emulator, against the deployed proxy:

1. Fresh install, log in, open attendance — no CORS/`NETWORK_ERROR`.
2. Rotate, background 1 min, foreground — session holds, no white screen.
3. Lock/unlock — no re-login prompt unless the token truly expired.

## If the proxy deployment moves

Installed apps keep calling the baked-in `PROD_API_BASE`
(`packages/web/src/lib/apiBase.js`) — there is no update channel. Recovery is
a new app build: update the constant, `npm run cap:sync`, `npm run
android:apk`, redistribute. Forks should set `VITE_NATIVE_API_BASE` to their
own proxy at build time instead.

## Live reload (dev only)

Point the shell at the Vite dev server:

```sh
# terminal 1 — the shell must reach the LAN IP, not localhost
npm --workspace @juet/web run dev -- --host

# then, temporarily, in capacitor.config.json:
#   "server": { "url": "http://192.168.1.20:5173", "cleartext": true }
VITE_NATIVE_API_BASE=/api npm run cap:sync
```

`VITE_NATIVE_API_BASE=/api` makes the WebView call its own origin, which the
Vite dev server proxies — so the preflighted absolute-URL path is bypassed while
you iterate.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Blank white screen after launch | Device is completely offline on initial boot before cache warmup, or deployment URL is unreachable. |
| Every request fails with a CORS error | WebView origin drifted from `WEBVIEW_ORIGIN` (`shared/cors.js`) or the proxy has no CORS headers deployed yet. |
| Requests fail with `NETWORK_ERROR` | Device offline, or the production proxy URL in `apiBase.js` is wrong/undeployed. |
| `./gradlew` cannot find a JDK / SDK | Set `JAVA_HOME` (JDK 21) and `ANDROID_HOME`; alternatively open `android/` in Android Studio. |
| Splash shows the Capacitor logo colours | `npm run cap:assets` was not run after checkout — icons and splash are checked in, so this only happens if they were overwritten. |
