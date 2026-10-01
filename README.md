# Lazyportal

The official portal (`studentportal.juet.ac.in/studentportal/`) forgets you on every visit. It wipes `localStorage` when the login page loads, and its token refresh never saves the new token. So you solve a captcha and type your password daily for no reason.

This repo logs in once through the same API, keeps the token in its own storage keys, and gives you a readable dashboard. Captcha is still required for the first login. There is no way around that, and this tool does not try.

## Run it

```sh
npm install
npm --workspace @juet/core test
npm --workspace @juet/web run dev
```

Local dev proxies `/api` to the portal, since the portal only accepts its own origin. Open `http://localhost:5173`, log in, reload. You stay logged in until the token expires or the server returns 401.

## Install on mobile

The login and dashboard offer a dismissible Home Screen install card: a native
install button on supported Android browsers, or Share → Add to Home Screen
guidance in iOS Safari. The APK fallback opens GitHub Releases (Android builds
will be published separately). See [installation behavior and verification](docs/INSTALL.md).

## Notes

- Password is saved in your device locally only if you tick Remember me.
- MIT. Nothing to do with JUET or JIL.
- I slopped it for me and myself only; expect nothing.
