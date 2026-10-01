# Lazyportal

The official portal (`studentportal.juet.ac.in/studentportal/`) forgets you on every visit. It wipes `localStorage` when the login page loads, and its token refresh never saves the new token. So you solve a captcha and type your password daily for no reason.

This repo logs in once through the same API, keeps the token in its own storage keys, and gives you a readable dashboard. Captcha is still required for the login lazyportal tries to solve it for you.

## Run it

```sh
npm install
npm test                          # core + web + proxy tests
npm --workspace @juet/web run dev # then open http://localhost:5173
```

Local dev proxies `/api` to the portal, since the portal only accepts its own origin.

## Android app

The same web build also ships as a native Android app (`com.lazyportal.juet`)
via Capacitor. The shell bundles `packages/web/dist` and talks to the hosted
proxy, because a WebView served from `https://localhost` has no same-origin
`/api`. Needs Node, JDK 21 and the Android SDK:

```sh
npm run cap:sync     # build web bundle + copy into android/
npm run android:apk  # ...and compile app-debug.apk
```

Icons, splash, API routing and release signing: [docs/ANDROID.md](docs/ANDROID.md).
CI compiles the APK on every push (`.github/workflows/android.yml`).

## Notes

- Password is saved in your device locally only if you tick Remember me.
- MIT. Nothing to do with JUET or JIL.
- I slopped it for me and myself only; expect nothing.
