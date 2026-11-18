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

Share [lazyportal-tan.vercel.app/download](https://lazyportal-tan.vercel.app/download) for a short Android download link.

## Development

## Development

```sh
npm install
npm test                          # mocked core + web + proxy/infra tests
npm --workspace @juet/web run dev # local Vite proxy /api -> portal (http://localhost:5173)
npm run android:apk               # build web, sync Capacitor policies, compile debug APK
```

See [AGENTS.md](./AGENTS.md) for architecture and file map, and [docs/ANDROID.md](./docs/ANDROID.md) for Android signing and routing.

```

## Notes & Disclaimer

- You're totally anonymous to us. your credentials are saved on your device.
- MIT. Nothing to do with JUET or JIL.
- I slopped it for me and myself only; expect nothing.

```
