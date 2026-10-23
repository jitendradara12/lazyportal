# Android app (Capacitor)

The Android app is the same web bundle inside Capacitor's WebView; only where API
traffic goes differs (see [API routing](#api-routing)).

| Piece | Location |
|---|---|
| Capacitor config | `capacitor.config.json` (repo root) |
| Native project (checked in) | `android/` |
| Synced web bundle (generated, git-ignored) | `android/app/src/main/assets/public/` |
| Launcher icons + splash (generated, checked in) | `android/app/src/main/res/mipmap-*/`, `drawable*/splash.png` |
| Icon/splash generator | `scripts/generate-app-assets.mjs` |
| CI (tests, debug APK, tagged releases) | `.github/workflows/build-apk.yml` |

The build embeds `public/offline.jpg` into `offline.html` using
`packages/web/scripts/offline-page.mjs`. Keep the source image separate for
editing; the bundled error page needs no image request or previously warmed cache.
Changes to this native fallback require rebuilding and installing the APK.

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

`android/` is checked in — edit native files in place. `cap sync` overwrites only
the generated files: the bundle, `capacitor.config.json`,
`capacitor.settings.gradle`, `capacitor-cordova-android-plugins/`.

## API routing

The portal 403s any `Origin`/`Referer` that is not its own, so the shell loads
the production deployment (`https://lazyportal-tan.vercel.app`) via `server.url`
in `capacitor.config.json` — instant daily updates, no APK reinstall.

| Build | `BASE_URL` | Resolved by |
|---|---|---|
| `npm run dev`, browser deployment | `/api` (same-origin) | Vite proxy / Vercel rewrite |
| Capacitor app | `https://lazyportal-tan.vercel.app/api` | `packages/web/src/lib/apiBase.js` |
| Fork / preview | `VITE_API_BASE` (web), `VITE_NATIVE_API_BASE` (app) | same file |

Two things must stay in sync:

1. `WEBVIEW_ORIGIN` in `shared/cors.js` ↔ `server.url` in `capacitor.config.json`
   (a test asserts this).
2. `PROD_API_BASE` in `packages/web/src/lib/apiBase.js` ↔ the deployed proxy URL.
   Installed apps call this baked-in address directly; moving the deployment requires
   updating this constant and redistributing the APK (`npm run cap:sync` + `npm run android:apk`).
   Forks should set `VITE_NATIVE_API_BASE`.

## Icons and splash

`npm run cap:assets` writes into `android/app/src/main/res/`:

- `mipmap-*/ic_launcher.png` — legacy launcher icon (the PWA icon).
- `mipmap-*/ic_launcher_round.png` — circular variant.
- `mipmap-*/ic_launcher_foreground.png` — white glyph for the adaptive icon
  (`mipmap-anydpi-v26/ic_launcher.xml`), drawn with ~25% padding so it survives
  every launcher mask.
- `drawable*/splash.png` — brand navy with the centred glyph, used by the
  launch theme.

Sources of truth: the inline SVG templates in
`packages/web/scripts/generate-icons.mjs` — the PNGs and `icon-maskable.svg` are
its *outputs*, so editing the SVGs does nothing. Change templates →
`npm --workspace @juet/web run generate-icons` → `npm run cap:assets` (reads
`icon-512.png` / `icon-maskable-512.png` only). `icon.svg` is the favicon/PWA
icon only.

## Session storage

The shell keeps the session in the WebView's `localStorage` (keys prefixed
`juet.portal.`), exactly like the browser build. Remembered passwords use the same
AES-256-GCM credential store as the browser: ciphertext in localStorage and a
non-exportable per-origin key in WebView IndexedDB (not Android Keystore).
Existing plaintext passwords migrate on app boot. `android:allowBackup="false"` in
`app/src/main/AndroidManifest.xml` keeps that out of cloud and device-transfer
backups; on a new device the user logs in again.

## Release build

```sh
cd android
./gradlew assembleRelease          # or: ./gradlew bundleRelease for an AAB
```

`app/build.gradle` keeps `versionCode` above previously shipped APKs via
`max(full Git commit count, run number + legacy android.yml high-water mark 13)`;
CI fetches full history and passes the run number through `VERSION_CODE_RUN`. On
a `v*` tag, CI sets `versionName` from the tag, uploads `app-debug.apk` as a run
artifact, builds a signed `app-release.apk`, and creates or updates a GitHub
Release with the APK attached. Release-tag builds require a persistent keystore —
CI fails rather than publishing with a temporary key that can't sign a future
update.

```sh
keytool -genkeypair -v \
  -keystore android/app/release.keystore \
  -alias lazyportal -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass 'choose-a-strong-store-password' \
  -keypass 'choose-a-strong-key-password' \
  -dname "CN=JUET Portal, O=Lazyportal, C=IN"
```

Repository Actions secrets, added before pushing a version tag:

- `KEYSTORE_BASE64` — output of `base64 < android/app/release.keystore | tr -d '\n'`
- `KEYSTORE_PASSWORD` — the keystore password
- `KEY_ALIAS` — the key alias (`lazyportal`)
- `KEY_PASSWORD` — the key password

The keystore is git-ignored; never commit it or share the encoded value. Never
distribute debug builds.

## Before merging a native change (device QA)

The local `NativeInteractions` plugin handles Android Back and light selection
haptics. Web overlays register Back handlers only while their tab is visible:
reconnect dialogs take priority over subject sheets/calendar menus, then other
tabs return to Attendance. At Attendance without overlays the native callback
is disabled, leaving Back-to-home to Android. The keyboard gets the first Back
when visible. Page reloads disable interception until the new page subscribes.
Haptics respect Android's touch-feedback settings and need no vibration permission;
they run on tab/target/calculator changes and accepted manual refreshes, with a
short rate limit. Browsers and older APKs skip the bridge safely.

The activity explicitly uses `adjustResize`; Capacitor's existing IME inset
handling resizes the WebView. Auth screens also follow the visual viewport,
scroll obscured inputs into view, and expose Next/Done keyboard actions.
Shipping the native bridge or resize configuration requires a rebuilt APK;
the hosted web changes must also be deployed for the remote-page shell.

Native interaction QA: open a subject and press Back (only the subject closes),
press Back from Marks/Exams/More (Attendance opens), then press Back again
(Android handles leaving). In login and reconnect, show the keyboard and verify
Back hides it first, Next moves between fields, the captcha remains visible,
and closing/reconnecting hides the keyboard. Check light feedback with Android's
touch-feedback setting enabled and disabled. Run `NativeInteractionsPluginTest`
for native dispatcher and plugin lifecycle regression coverage.

Exam calendar icons use the local `ExamCalendar` Capacitor plugin to open an
`ACTION_INSERT` calendar editor with the subject, IST start/end instants, and
room-seat location. The user saves the event; no calendar permission is requested.
This bridge requires a rebuilt APK. Older APKs and devices without a calendar
handler fall back to Google Calendar. On rebuilt APKs, calendar-file exports
(including bulk export) use Android's system Save dialog through the same plugin;
the app writes UTF-8 `.ics` content to the user-selected document. Cancelling the
dialog leaves the calendar unchanged. Older APKs without this plugin hide file
export because WebView cannot save browser blob downloads. Browsers still download
the `.ics` file normally.

CI only compiles the APK; it never boots the WebView. Manual signoff on a
physical device or emulator, against the deployed proxy:

1. Fresh install, log in, open attendance — no CORS/`NETWORK_ERROR`.
2. Rotate, background 1 min, foreground — session holds, no white screen.
3. Lock/unlock — no re-login prompt unless the token truly expired.
4. Exams: tap a calendar icon, check date/time and room-seat location in the
   native editor, then cancel and return. Save a test event and verify it in
   Calendar. Without a calendar handler, verify the fallback picker opens.
5. Export upcoming exams, choose a location in the system Save dialog, and verify
   the saved `.ics` contains all upcoming exams. Check cancelling the dialog and
   exporting a single exam from the fallback picker.

Native regression tests exercise Android JSON timestamp parsing, calendar intent
extras, the document-picker intent, UTF-8 writes, cancellation, and write failures:
`cd android && ./gradlew :app:connectedDebugAndroidTest` with an emulator/device running.

## Live reload (dev only)

```sh
# terminal 1 — the shell must reach the LAN IP, not localhost
npm --workspace @juet/web run dev -- --host

# then, temporarily, in capacitor.config.json:
#   "server": { "url": "http://192.168.1.20:5173", "cleartext": true }
VITE_NATIVE_API_BASE=/api npm run cap:sync
```

`VITE_NATIVE_API_BASE=/api` makes the WebView call its own origin, which the
Vite dev server proxies.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Blank white screen after launch | Device offline before cache warmup, or deployment URL unreachable. |
| Every request fails with a CORS error | WebView origin drifted from `WEBVIEW_ORIGIN` (`shared/cors.js`) or the proxy has no CORS headers deployed yet. |
| Requests fail with `NETWORK_ERROR` | Device offline, or the production proxy URL in `apiBase.js` is wrong/undeployed. |
| `./gradlew` cannot find a JDK / SDK | Set `JAVA_HOME` (JDK 21) and `ANDROID_HOME`; or open `android/` in Android Studio. |
| Splash shows the Capacitor logo colours | `npm run cap:assets` was not run after checkout — icons/splash are checked in, so this only happens if they were overwritten. |
