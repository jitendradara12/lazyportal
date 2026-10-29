# Protocol Notes

JUET portal protocol quirks, endpoints, and encryption specifications. Base page: `https://studentportal.juet.ac.in/studentportal/`, API prefix: `https://studentportal.juet.ac.in/StudentPortalAPI`.

## Authentication Flow

1. **Captcha**: `GET /token/getcaptcha` without authorization headers (auth headers trigger rejected CORS preflights). Returns `{hidden, image}`.
2. **Pretoken check**: `POST /token/pretoken-check` with `Authorization: Bearer` and a fresh `LocalName` header. Body is AES-encrypted `{username, usertype, captcha}`. Returns `{random, otppwd}` (`random` is single-use).
3. **Generate token**: `POST /token/generatewebtoken` with the same headers. Body is AES-encrypted `{otppwd, username, passwordotpvalue, Modulename: "STUDENTMODULE", random}`. Returns `regdata` containing the JWT, student profile, and institute affiliations.

## Authenticated Requests

- Headers: `Authorization: Bearer <token>` and a fresh client-generated `LocalName` header on every request (requests missing `LocalName` return empty 200 responses).
- Request payloads: Most endpoints require AES-encrypted JSON. A subset expects plain JSON (e.g. attendance registration list, fee summary, personal/medical info).
- Expiry: HTTP 401 or an HTTP 200 payload with `status.responseStatus: "Failure"` signaling session expiry.

## Marks History & PDF Reports

- The JSON endpoint `getstudent-exammarks` often returns only the most recent exam event per subject (e.g. T2 replaces T1).
- The official event-wise PDF report at `GET /studentsexamview/printstudent-exammarks/{instituteid}/{registrationid}/{registrationcode}` retains all historical exam events (OM/FM columns).
- Fresh JSON scores override PDF rows for matching exams.

## Cryptography

- Algorithm: AES-128-CBC with PKCS#7 padding and base64 output.
- Key: Date-derived 16-character string (`generateValue()` in `crypto.js`).
- IV: Fixed 16-byte string `dcek9wb8frty1pnm`.
