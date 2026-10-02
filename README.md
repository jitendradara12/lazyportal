# Lazyportal

The official portal (`studentportal.juet.ac.in/studentportal/`) forgets you on every visit. It wipes `localStorage` when the login page loads, and its token refresh never saves the new token. So you solve a captcha and type your password daily for no reason.

This repo logs in once through the same API, keeps the token in its own storage keys, and gives you a readable dashboard. Captcha is still required for the login lazyportal tries to solve it for you.

## Run it

```sh
npm install
npm --workspace @juet/core test
npm --workspace @juet/web run dev
```

Local dev proxies `/api` to the portal, since the portal only accepts its own origin.

## Notes

- Password is saved in your device locally only if you tick Remember me.
- MIT. Nothing to do with JUET or JIL.
- I slopped it for me and myself only; expect nothing.
