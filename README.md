# LazyPortal

Just a better alternative to JUET student portal (`studentportal.juet.ac.in`).

## Why?

The official portal forgets you on every visit and forces you to type your password and solve a captcha every single day for no reason.

**LazyPortal fixes that:**
- **Persistent sessions:** Log in once and stay logged in.
- **Auto-captcha:** Automatically attempts to solve the captcha for you.
- **Better UI:** It's just better. believe me.
- **Native Android support:** Ships as a lightweight Capacitor build.

## Download

- **Android**: [Download latest APK](https://github.com/jitendradara12/lazyportal/releases/latest/download/app-release.apk)
- **iOS/Desktop**: [Open LazyPortal](https://lazyportal-tan.vercel.app)

Share [lazyportal-tan.vercel.app/download](https://lazyportal-tan.vercel.app/download) for a short Android download link. It follows the latest stable GitHub release automatically.

## Development

### Web

Local dev proxies `/api` to the portal since the upstream server only accepts requests from its own origin.

```sh
npm install
npm test
npm --workspace @juet/web run dev
```

TLS regression tests require OpenSSL. They generate temporary test certificates
and use a local loopback connection; tests do not call the live portal.

### Android

The web bundle compiles directly into a native Android app via Capacitor:

```sh
npm run cap:sync    # build and sync to android/
npm run android:apk # compile app-debug.apk
```

## Notes & Disclaimer

- You're totally anonymous to us. your credentials are saved on your device.
- MIT. Nothing to do with JUET or JIL.
- I slopped it for me and myself only; expect nothing.
