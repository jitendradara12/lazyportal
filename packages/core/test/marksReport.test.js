import test from "node:test";
import assert from "node:assert/strict";
import { parseMarksReport } from "../src/marksReport.js";
import { getMarks, getMarksReport } from "../src/features.js";

const item = (text, x, y, width = 20) => ({ text, x, y, width });
function table(code = "2026ODDSEM") {
  return [item(`Registration Code: ${code}`, 20, 800),
    ...["P-1", "P-2", "TEST-1", "TEST-2", "TEST-3"].flatMap((event, i) => [
      item(event, 320 + i * 160, 740), item("OM/FM", 280 + i * 160, 720), item("OW/WT", 360 + i * 160, 720),
    ])];
}
const page = [...table(), item("SAMPLE THEORY", 20, 680), item("(CS303)", 20, 665),
  item("7/15", 600, 672), item("7/15", 680, 672),
  item("13/25", 760, 672), item("13/25", 840, 672),
  item("21.5/35", 920, 672), item("21.5/35", 1000, 672),
  item("SAMPLE LAB", 20, 640), item("(CS201)", 20, 625),
  item("0/15", 280, 632), item("0/15", 360, 632),
  item("AB/15", 440, 632), item("0/15", 520, 632)];

test("event-wise report recovers all theory/practical events, fractional/zero/absent marks, ignoring weightage", () => {
  const rows = parseMarksReport([page, [...table(), item("OTHER COURSE", 20, 680), item("(CS999)", 20, 665), item("9/15", 600, 672)]], "2026ODDSEM");
  assert.deepEqual(rows.map(({ subjectcode, eventcode, obtainedmarks, fullmarks }) => [subjectcode, eventcode, obtainedmarks, fullmarks]), [
    ["CS303", "TEST-1", 7, 15], ["CS303", "TEST-2", 13, 25], ["CS303", "TEST-3", 21.5, 35],
    ["CS201", "P-1", 0, 15], ["CS201", "P-2", "AB", 15], ["CS999", "TEST-1", 9, 15],
  ]);
  assert.equal(rows[0].subjectdesc, "SAMPLE THEORY");
  assert.deepEqual(parseMarksReport([table()], "2026ODDSEM"), []);
  assert.throws(() => parseMarksReport([page], "2026EVESEM"), { code: "INVALID_RESPONSE" });
  assert.throws(() => parseMarksReport([[item("Registration Code: 2026ODDSEM", 0, 0)]], "2026ODDSEM"), { code: "INVALID_RESPONSE" });
});

test("report read uses the selected semester; fresh JSON corrections override report scores", async () => {
  let seen;
  const client = {
    getReport: async (path) => { seen = path; return new Uint8Array([1, 2]); },
    post: async () => ({ response: { viewmarksbystudent: [{ subjectcode: "CS303", eventcode: "T2", obtainedmarks: 14, fullmarks: 25 }] } }),
  };
  const readPdfText = async (bytes) => { assert.deepEqual([...bytes], [1, 2]); return [page]; };
  const params = { registrationid: "sem1", registrationcode: "2026ODDSEM", readPdfText };
  const result = await getMarks(client, { instituteid: "i1" }, params);
  assert.equal(seen, "/studentsexamview/printstudent-exammarks/i1/sem1/2026ODDSEM");
  assert.equal(result.historyRecovered, true);
  assert.equal(result.rows.filter((row) => row.subjectcode === "CS303").length, 3);
  assert.equal(result.rows.find((row) => row.eventcode === "T2").obtainedmarks, 14);
  await assert.rejects(() => getMarksReport(client, { instituteid: "../other" }, params), { code: "INVALID_RESPONSE" });
  client.getReport = async () => { throw new Error("Unavailable"); };
  const partial = await getMarks(client, { instituteid: "i1" }, params);
  assert.equal(partial.historyRecovered, false);
  assert.equal(partial.rows[0].obtainedmarks, 14);
  assert.match(partial.historyError, /could not be recovered/);
});
