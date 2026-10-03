# Lazyportal

The official portal (`studentportal.juet.ac.in/studentportal/`) forgets you on every visit. It wipes `localStorage` when the login page loads, and its token refresh never saves the new token. So you solve a captcha and type your password daily for no reason.

This repo logs in once through the same API, keeps the token in its own storage keys, and gives you a readable dashboard. Captcha is still required for the login; lazyportal tries to solve it for you.

## Run it

```sh
npm install
npm test                          # core + web + proxy tests
npm --workspace @juet/web run dev # then open http://localhost:5173
```

Local dev proxies `/api` to the portal, since the portal only accepts its own origin.

## Android app

The same web build also ships as a native Android app (`com.lazyportal.juet`)
via Capacitor.

```sh
npm run cap:sync    # build web bundle + copy into android/
npm run android:apk # ...and compile app-debug.apk
```

Icons, splash, API routing and release signing: [docs/ANDROID.md](docs/ANDROID.md).
CI builds a debug APK on pushes to `master`, pull requests, and manual runs
(`.github/workflows/build-apk.yml`). Pushing a `v*` tag additionally builds a
signed release APK and publishes it to GitHub Releases after signing secrets
are configured.

## Notes

- Password is saved in your device locally only if you tick Remember me.
- MIT. Nothing to do with JUET or JIL.
- I slopped it for me and myself only; expect nothing.
