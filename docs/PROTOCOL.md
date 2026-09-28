# Protocol notes

Base page `https://studentportal.juet.ac.in/studentportal/`, API at `https://studentportal.juet.ac.in/StudentPortalAPI`. Verified live 2026-09-28.

## Captcha

`GET /token/getcaptcha`, no auth headers (sending them triggers a CORS preflight the server rejects). Returns `{hidden, image}`. Echo both back with the typed text.

## Pretoken

`POST /token/pretoken-check` with `Authorization: Bearer` (empty is fine) plus a fresh `LocalName` header, body is AES of `{username, usertype, captcha}`. Without `LocalName` the server answers `200` with an empty body. Bad captcha gives `404 Invalid captcha submitted..`. Good one returns `{random, otppwd}`. The `random` works once.

## Password

`POST /token/generatewebtoken`, same headers, body is AES of `{otppwd, username, passwordotpvalue, Modulename: "STUDENTMODULE", random}`. Returns `regdata` with the token, profile fields, and institute list.

## Later calls

Same headers with the real token and a fresh `LocalName` each request. Most bodies are AES JSON, but not all. Plain-JSON endpoints (verified one by one,
wrong mode returns 400): fee summary, attendance registration list, personal info,
all service-request grids, medical info.

`401` means log in again. The official refresh call never stores a new token, so it buys nothing.

## Crypto

Key comes from the current date (`qa8y…ty1pn`, 16 chars), IV is `dcek9wb8frty1pnm`, AES-128-CBC with base64 output. Matches CryptoJS byte for byte.
