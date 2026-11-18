# Android App (Capacitor)

Targets `minSdk 24 / compileSdk 36 / targetSdk 36` (Node 22+, JDK 21, Android SDK API 36).

## Routing & Compatibility

| Target | Base URL | Mechanism |
|---|---|---|
| Dev / browser | `/api` | Vite proxy / Vercel rewrite (`api/proxy.js`) |
| Android (`PortalHttp`) | Direct to JUET | `PortalHttpPlugin` (allowlisted in `portal-api-policy.json`) |
| Older APK / proxy fallback | `https://lazyportal-tan.vercel.app/api` | `packages/web/src/lib/apiBase.ts` (`PROD_API_BASE`) |
| Fork / override | `VITE_API_BASE` / `VITE_NATIVE_API_BASE` | Build-time env (`VITE_API_TRANSPORT=proxy` forces proxy) |

- `capacitor.config.json` `server.url` **must** match `WEBVIEW_ORIGIN` in `shared/cors.js`.
- **TLS repair**: JUET omits its GoDaddy G2 intermediate; `PortalTls` injects `shared/portal-intermediate.pem` for JUET connections only while keeping system root and hostname checks enforced.
- **Official portal WebView**: runs isolated at `https://official.lazyportal.invalid` with in-memory storage and strict `official-portal-policy.json` allowlisting.

## Releases & Signing

Tagged pushes (`v*`) build signed `app-release.apk` via `.github/workflows/build-apk.yml` (permanent URL: `https://github.com/jitendradara12/lazyportal/releases/latest/download/app-release.apk`, aliased by `/download`). Keep the same `applicationId` (`com.lazyportal.juet`) and keystore so Android updates in place.

- **Required CI secrets**: `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS` (`lazyportal`), `KEY_PASSWORD`.
- **Optional Firebase Alerts secrets**:
  - `GOOGLE_SERVICES_JSON_BASE64`: base64-encoded `android/app/google-services.json` for FCM topic notifications (`alerts`). Builds without it remain safe and hide the Alerts toggle at runtime.
  - `FIREBASE_SERVICE_ACCOUNT_JSON`: Firebase service account JSON for the **Send Alert** (`send-alert.yml`) manual GitHub Action. You can also broadcast directly to topic `alerts` from Firebase Console → Messaging.
- **New keystore**: `keytool -genkeypair -v -keystore android/app/release.keystore -alias lazyportal -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=JUET Portal, O=Lazyportal, C=IN"`
