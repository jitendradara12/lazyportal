# JUET student portal, fixed

The official portal (`studentportal.juet.ac.in/studentportal/`) forgets you on every visit. It wipes `localStorage` when the login page loads, and its token refresh never saves the new token. So you solve a captcha and type your password daily for no reason.

This repo logs in once through the same API, keeps the token in its own storage keys, and gives you a readable dashboard. Captcha is still required for the first login. There is no way around that, and this tool does not try.

## Layout

```
packages/core/  # protocol: crypto, client, auth, session, features. Zero deps, tested with node --test
packages/web/   # Vite + React app on top of core
docs/           # protocol notes and architecture
```

## Run it

```sh
npm install
npm --workspace @juet/core test
npm --workspace @juet/web run dev
```

Local dev proxies `/api` to the portal, since the portal only accepts its own origin. Open `http://localhost:5173`, log in, reload. You stay logged in until the token expires or the server returns 401.

## Notes

- Passwords are never stored. Only the token and profile fields.
- Be gentle with the server. Do not share credentials in issues.
- MIT. Nothing to do with JUET or JIL.
