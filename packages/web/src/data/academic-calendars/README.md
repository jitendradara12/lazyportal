# Fix or add a calendar

> just give this to any AI with the calendar

Anyone can fix dates or add a semester. Edit a JSON file here and open a pull
request. Give this guide and the university calendar to an LLM if you want help.

Use one file per semester, named `2026-27-even.json`:

```json
{
  "id": "2026-27-even",
  "academicYear": "2026-27",
  "term": "even",
  "startsOn": "2027-01-04",
  "events": [
    {
      "id": "t1",
      "title": "Test 1",
      "category": "exam",
      "startDate": "2027-02-08",
      "endDate": "2027-02-13"
    }
  ]
}
```

- `term`: `odd` or `even`. `startsOn`: semester registration/start date.
- Categories: `exam`, `holiday`, `break`, `deadline`, `academic`.
- Dates: `YYYY-MM-DD`. `endDate` includes that day; omit it for one day.
- `dateRule`: `before` or `from` uses `startDate`; `relative` uses `timing`,
  such as `Within 10 days of practical examinations`; `tba` means unannounced.
  Omit dates for `relative` and `tba`. Started `from` events stay in date guidance.
  Copy the calendar's meaning; never guess.
- Optional: `status: "tentative"` for proposed/conditional dates, `audience`
  for who an event concerns, `notes` for an event's qualifications.
  `audience: "Faculty & staff"` hides staff-only events from the student view.
- Optional: `aliases` is a list of common search names, such as `["Diwali"]`
  for Deepawali. It does not change the published title or calendar exports.
- Year and Ph.D. filters use stated audiences. Missing or unrecognized audiences
  stay visible; do not infer applicability from an event's title.
- Include each event once. Keep existing IDs when correcting dates.
- Keep older semesters. New JSON files appear automatically. Leave PDFs out.

Run `npm test` and `npm run build`. In your pull request, say what changed and
where the dates came from. Only fixed dates export to calendars.
