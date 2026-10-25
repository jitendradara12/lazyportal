# Academic read coverage before APK release

Checked on 2026-10-25 against the current working tree, including untracked files,
and the signed-in old WebKiosk and new student portal browser tabs.

Scope: academic reads. Payments, financial reports, hostel functions, medical
records, feedback submission, registration changes and certificate acceptance
are excluded from this audit. This document does not add app screens or permissions.

## Installed permission coverage

All 31 endpoints in the following groups are present in both live
`portalApiPolicy` and the packaged `portal-api-policy.json`. No missing native
permission was found for these known reads.

| Feature | Endpoints | Main-app readiness |
|---|---:|---|
| Attendance and subject history | 4 | Implemented |
| Examination schedule, events and marks | 5 | Implemented |
| Grade cards | 3 | Core helpers and UI exist; section disabled |
| SGPA/CGPA and semester subject detail | 4 | Core helpers and UI exist; section disabled |
| Registered subjects with faculty | 4 | Faculty UI and core helpers exist |
| Subject-choice reports | 2 | Implemented as Subjects |
| Supplementary, summer and GIP choice reports | 2 | Native permission exists; main-app implementation still needed |
| Registration slips | 2 | Native permission exists; main-app implementation still needed |
| MOOC subject status | 2 | Native permission exists; main-app implementation still needed |
| Subject add/drop status | 2 | Native permission exists; main-app implementation still needed |
| Disciplinary records | 1 | Native permission exists; main-app implementation still needed |

Sources: `packages/core/src/features.js`, `packages/core/src/officialPortal.js`,
`packages/core/src/portalTransport.js`, `packages/web/src/sections/index.ts`,
and `android/app/src/main/assets/portal-api-policy.json`.

## Live observations

- Old WebKiosk exposes registered subjects, subject faculty, disciplinary records,
  seating plans and SGPA/CGPA. Its SGPA/CGPA report contains semester rows.
- The new portal exposes attendance, faculty, marks, examination schedules,
  grade cards, results, subject-choice reports, registration slips and MOOC status.
- New-portal SGPA/CGPA student/current-semester reads returned HTTP 200;
  `getallsemesterdata` returned HTTP 500 and the screen reported no result.
- Grade-card student, registration-list and grade-card reads returned HTTP 200.
  The selected semester's grade table contained no rows.
- Registration-slip student and selected-semester reads returned HTTP 200 and
  exposed a report download button. The downloaded report was not inspected.
- Supplementary-choice and MOOC semester lookups returned HTTP 500, preventing
  verification of their subsequent subject-detail reads for this account.
- Add/drop status and disciplinary records were checked against packaged
  permissions only, not exercised on the new portal in this session.

## Meaning for future releases

Known reads above can be implemented or repaired in live core and web code
without changing the APK. Permission coverage does not establish response schema,
successful upstream behavior, or finished UI. Validate real responses before
enabling an unused feature; keep unavailable sections disabled.

A newly discovered read endpoint must be reviewed and added to live core policy.
Older APKs can use the existing proxy for it, selected before dispatch. A native
request that has already failed is not automatically retried through the proxy.
Direct native use of that new endpoint requires a later APK permission update.

This audit covers the current native source and generated policy, not an
installed release APK. Native CI and candidate-device checks remain required.
