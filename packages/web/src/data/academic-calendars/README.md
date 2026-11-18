# Fix or add a calendar

> Give this file and the university calendar to any LLM to format or update a semester.

Add one JSON file per semester named `<academicYear>-<term>.json` (e.g. `2026-27-even.json`):

```json
{
  "id": "2026-27-even",
  "academicYear": "2026-27",
  "term": "even",
  "startsOn": "2027-01-04",
  "events": [
    { "id": "t1", "title": "Test 1", "category": "exam", "startDate": "2027-02-08", "endDate": "2027-02-13" }
  ]
}
```

- `term`: `odd` or `even`. `startsOn`: semester registration/start date. Files sharing `academicYear` merge into one timeline (`id` must be unique within each file; keep existing `id`s when fixing dates).
- `category`: `exam`, `holiday`, `break`, `deadline`, or `academic`.
- Dates: `YYYY-MM-DD`; `endDate` is inclusive (omit for single-day events).
- `dateRule`: `before` or `from` (with `startDate`), `relative` (with `timing`, e.g. `"Within 10 days of practical examinations"`), or `tba`. Omit dates for `relative`/`tba`; copy the calendar's meaning rather than guessing.
- Optional fields: `status: "tentative"`, `notes`, `aliases` (search-only names like `["Diwali"]`), `audience` (`"Faculty & staff"` hides staff-only events from students; shown as `"For ..."`, never inferred from title).
- Keep older semesters, include each event once, omit PDFs. Only fixed-date events export to calendars.

Run `npm test` and `npm run build`, and note the source of dates in your PR.
