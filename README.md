# LazyPortal

Read-only client for the JUET student portal (`studentportal.juet.ac.in`) with persistent sessions, local auto-captcha, and an Android Capacitor shell.

- **Web**: [lazyportal-tan.vercel.app](https://lazyportal-tan.vercel.app)
- **Android APK**: [lazyportal-tan.vercel.app/download](https://lazyportal-tan.vercel.app/download) (redirects to the latest GitHub release)

## Development

```sh
npm install
npm test                          # mocked core + web + proxy/infra tests (OpenSSL required for TLS tests)
npm --workspace @juet/web run dev # local Vite proxy /api -> portal (http://localhost:5173)
npm run android:apk               # build web, sync Capacitor policies, compile debug APK
```

See [AGENTS.md](./AGENTS.md) for architecture and file map, and [docs/ANDROID.md](./docs/ANDROID.md) for Android signing and routing.

## Notes

- Credentials are encrypted locally on your device; nothing is sent to third-party servers.
- MIT licensed. Unaffiliated with JUET or JIL.
