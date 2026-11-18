import test from "node:test";
import assert from "node:assert/strict";

const values = new Map();
let dispatchedEvents = [];

globalThis.window = {
  dispatchEvent(event) {
    dispatchedEvents.push(event.type);
    return true;
  },
  addEventListener() {},
  removeEventListener() {},
};

const docListeners = new Map();
globalThis.document = {
  addEventListener(type, cb) {
    if (!docListeners.has(type)) docListeners.set(type, new Set());
    docListeners.get(type).add(cb);
  },
  removeEventListener(type, cb) {
    docListeners.get(type)?.delete(cb);
  },
  visibilityState: "visible",
};

globalThis.localStorage = {
  getItem(key) {
    return values.get(key) ?? null;
  },
  setItem(key, value) {
    values.set(key, String(value));
  },
  removeItem(key) {
    values.delete(key);
  },
  clear() {
    values.clear();
  },
};

globalThis.CustomEvent = class CustomEvent {
  constructor(type, init) {
    this.type = type;
    this.detail = init?.detail;
  }
};

const {
  getPortalDayKey,
  isCurrentPortalDay,
  getNextPortalResetTimestamp,
  getMsUntilNextPortalDay,
  subscribePortalDayRollover,
  PORTAL_DAY_CUTOFF_HOUR_IST,
  PORTAL_DAY_CUTOFF_MINUTE_IST,
  FEATURE_TTL,
  computeSubjectRowChecksum,
  computeSubjectComponentChecksum,
  hasSubjectCountCoverage,
  computeLegacySubjectRowChecksum,
  doesSubjectNeedDeepFetch,
  REFRESH_THROTTLE_MS,
  NATIVE_REFRESH_THROTTLE_MS,
  shouldThrottleRefresh,
  recordRefreshAttempt,
  getThrottleKey,
  toMs,
} = await import("../src/lib/portalSchedule.ts");

test("portal day cutoff is 02:00 AM IST", () => {
  assert.equal(PORTAL_DAY_CUTOFF_HOUR_IST, 2);
  assert.equal(PORTAL_DAY_CUTOFF_MINUTE_IST, 0);
  assert.equal(REFRESH_THROTTLE_MS, 20_000);
  assert.equal(NATIVE_REFRESH_THROTTLE_MS, 2_000);
});

test("01:59:59 IST belongs to previous portal day, 02:00:00 IST starts new portal day", () => {
  // 2026-10-07 01:59:59 IST is UTC 2026-10-06 20:29:59
  const beforeCutoff = Date.UTC(2026, 9, 6, 20, 29, 59);
  // 2026-10-07 02:00:00 IST is UTC 2026-10-06 20:30:00
  const atCutoff = Date.UTC(2026, 9, 6, 20, 30, 0);
  // 2026-10-07 14:00:00 IST is UTC 2026-10-07 08:30:00
  const midDay = Date.UTC(2026, 9, 7, 8, 30, 0);

  assert.equal(getPortalDayKey(beforeCutoff), "2026-10-06");
  assert.equal(getPortalDayKey(atCutoff), "2026-10-07");
  assert.equal(getPortalDayKey(midDay), "2026-10-07");
});

test("isCurrentPortalDay correctly identifies timestamps in same portal day", () => {
  const morning = Date.UTC(2026, 9, 7, 3, 30, 0); // 09:00 AM IST
  const evening = Date.UTC(2026, 9, 7, 14, 30, 0); // 08:00 PM IST
  const lateNight = Date.UTC(2026, 9, 7, 20, 20, 0); // 01:50 AM IST next day (Oct 8)
  const afterReset = Date.UTC(2026, 9, 7, 20, 31, 0); // 02:01 AM IST next day (Oct 8)

  assert.equal(isCurrentPortalDay(morning, evening), true);
  assert.equal(isCurrentPortalDay(morning, lateNight), true);
  assert.equal(isCurrentPortalDay(morning, afterReset), false);
  assert.equal(isCurrentPortalDay(null, evening), false);
  assert.equal(isCurrentPortalDay(undefined, evening), false);
  assert.equal(isCurrentPortalDay(0, evening), false);
});

test("getNextPortalResetTimestamp returns exact upcoming 02:00 AM IST", () => {
  const midDay = Date.UTC(2026, 9, 7, 8, 30, 0); // 14:00 IST on Oct 7
  const nextReset = getNextPortalResetTimestamp(midDay);
  // Upcoming reset should be Oct 8 02:00 AM IST = UTC Oct 7 20:30:00
  assert.equal(nextReset, Date.UTC(2026, 9, 7, 20, 30, 0));
  assert.equal(getMsUntilNextPortalDay(midDay), 12 * 3600 * 1000);
});

test("computeSubjectRowChecksum produces deterministic signature of subject row", () => {
  const rowA = {
    subjectcode: "CS101",
    totalclass: 20,
    totalpresent: 18,
    Ltotalclass: 15,
    Ltotalpresent: 14,
    Lpercentage: "93.3",
    Ttotalclass: 5,
    Ttotalpresent: 4,
    Tpercentage: "80.0",
  };
  const chkA = computeSubjectRowChecksum(rowA);
  assert.equal(chkA, computeSubjectRowChecksum({ ...rowA }));

  // Changing present count alters checksum (detecting attendance corrections)
  const rowCorrection = { ...rowA, totalpresent: 19, Ltotalpresent: 15 };
  const chkCorr = computeSubjectRowChecksum(rowCorrection);
  assert.notEqual(chkA, chkCorr);

  // Changing class count alters checksum
  const rowNewClass = { ...rowA, totalclass: 21, totalpresent: 19 };
  const chkNew = computeSubjectRowChecksum(rowNewClass);
  assert.notEqual(chkA, chkNew);
});

test("doesSubjectNeedDeepFetch accurately identifies when to fetch or skip", () => {
  const row = {
    subjectcode: "CS101",
    Lsubjectcomponentid: "lecture",
    totalclass: 20,
    totalpresent: 18,
    Ltotalclass: 20,
    Ltotalpresent: 18,
  };
  const checksum = computeSubjectRowChecksum(row);
  const dummyDetail = { L: { totalclass: 20, totalpresent: 18 } };

  // 1. Missing detail -> needs fetch
  assert.equal(doesSubjectNeedDeepFetch(row, null, Date.now(), checksum), true);
  assert.equal(doesSubjectNeedDeepFetch(row, {}, Date.now(), checksum), true);

  // 2. Matching checksum -> SKIPS fetch (saves network call and memory)
  assert.equal(doesSubjectNeedDeepFetch(row, dummyDetail, Date.now(), checksum), false);

  // 3. Different checksum (e.g. teacher gave attendance for 1 more lecture) -> needs fetch
  const updatedRow = { ...row, totalclass: 21, totalpresent: 19 };
  assert.equal(doesSubjectNeedDeepFetch(updatedRow, dummyDetail, Date.now(), checksum), true);

  // 4. Attendance correction (total classes stayed 20, but present changed from 18 to 19) -> needs fetch!
  const correctedRow = { ...row, totalpresent: 19 };
  assert.equal(doesSubjectNeedDeepFetch(correctedRow, dummyDetail, Date.now(), checksum), true);

  // 5. A matching checksum stays fresh beyond the old seven-day fallback.
  const fixedNow = 1760000000000;
  const eightDaysAgo = fixedNow - 8 * 24 * 3600 * 1000;
  assert.equal(doesSubjectNeedDeepFetch(row, dummyDetail, eightDaysAgo, checksum, fixedNow), false);
  const yearAgo = fixedNow - 365 * 24 * 3600 * 1000;
  assert.equal(doesSubjectNeedDeepFetch(row, dummyDetail, yearAgo, checksum, fixedNow), false);

  // 6. Missing timestamps remain untrusted and are refreshed once.
  assert.equal(doesSubjectNeedDeepFetch(row, dummyDetail, null, checksum, fixedNow), true);

  // 7. Legacy entries without checksums keep the bounded migration path.
  assert.equal(doesSubjectNeedDeepFetch(row, dummyDetail, fixedNow - 3600 * 1000, null, fixedNow), false);
  const classAddedRow = { ...row, totalclass: 21 };
  assert.equal(doesSubjectNeedDeepFetch(classAddedRow, dummyDetail, fixedNow, null, fixedNow), true);
  assert.equal(doesSubjectNeedDeepFetch(row, dummyDetail, eightDaysAgo, null, fixedNow), true);

  // 8. Incomplete cache (missing or null component expected by row) MUST trigger deep fetch
  const multiCompRow = {
    subjectcode: "MA106",
    Lsubjectcomponentid: "c_lec",
    Tsubjectcomponentid: "c_tut",
    Lpercentage: "96.8",
    Tpercentage: "100",
  };
  const multiChecksum = computeSubjectRowChecksum(multiCompRow);
  const incompleteDetailOnlyT = { T: { summary: [{ present: "Y" }] } };
  const incompleteDetailNullL = { L: null, T: { summary: [{ present: "Y" }] } };
  const completeDetail = { L: { totalclass: 31, totalpresent: 30 }, T: { totalclass: 3, totalpresent: 3 } };
  assert.equal(doesSubjectNeedDeepFetch(multiCompRow, incompleteDetailOnlyT, fixedNow, multiChecksum, fixedNow), true);
  assert.equal(doesSubjectNeedDeepFetch(multiCompRow, incompleteDetailNullL, fixedNow, multiChecksum, fixedNow), true);
  assert.equal(doesSubjectNeedDeepFetch(multiCompRow, completeDetail, fixedNow, multiChecksum, fixedNow), false);
});

test("isCurrentPortalDay defaults to now for single-arg freshness checks", () => {
  const now = Date.now();
  assert.equal(isCurrentPortalDay(now), true);
  assert.equal(isCurrentPortalDay(null), false);
  assert.equal(isCurrentPortalDay(undefined), false);

  const yesterday = now - 24 * 3600 * 1000 * 2;
  assert.equal(isCurrentPortalDay(yesterday), false);
});

test("FEATURE_TTL keeps non-attendance pages cached until explicit refresh", () => {
  assert.equal(FEATURE_TTL.marks, Number.POSITIVE_INFINITY);
  assert.equal(FEATURE_TTL.exams, Number.POSITIVE_INFINITY);
  assert.equal(FEATURE_TTL.faculty, Number.POSITIVE_INFINITY);
  assert.equal(FEATURE_TTL.pastDetail, 30 * 24 * 60 * 60 * 1000);
});

test("subscribePortalDayRollover returns an unsubscribe cleanup function", () => {
  let called = false;
  const unsubscribe = subscribePortalDayRollover(() => {
    called = true;
  });
  assert.equal(typeof unsubscribe, "function");
  unsubscribe();
  assert.equal(called, false);
});

test("subscribePortalDayRollover triggers callback on visibilitychange only when portal day rolled over", () => {
  let callCount = 0;
  const unsub = subscribePortalDayRollover(() => {
    callCount++;
  });
  globalThis.document.visibilityState = "visible";
  const listeners = docListeners.get("visibilitychange");
  assert.ok(listeners && listeners.size > 0);

  // 1. Same portal day: does not spuriously trigger callback
  for (const cb of listeners) cb();
  assert.equal(callCount, 0);

  // 2. Advance to next portal day: visibility change triggers rollover callback
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 24 * 3600 * 1000;
    for (const cb of listeners) cb();
    assert.equal(callCount, 1);
    assert.ok(dispatchedEvents.includes("juet:refresh-attendance"));
  } finally {
    Date.now = realNow;
  }

  unsub();
});

test("refresh throttles are isolated between dashboard and attendance and enforce 20s cooldown", () => {
  values.clear();
  assert.equal(REFRESH_THROTTLE_MS, 20_000);

  // Initially unthrottled
  assert.equal(shouldThrottleRefresh("dashboard"), false);
  assert.equal(shouldThrottleRefresh("attendance"), false);

  // Record a dashboard attempt
  recordRefreshAttempt("dashboard");

  // Dashboard is throttled, but attendance is NOT blocked!
  assert.equal(shouldThrottleRefresh("dashboard"), true);
  assert.equal(shouldThrottleRefresh("attendance"), false);

  // Custom cooldown works
  assert.equal(shouldThrottleRefresh("dashboard", 0), false);

  // After 21s, dashboard throttle clears
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 21_000;
    assert.equal(shouldThrottleRefresh("dashboard"), false);
  } finally {
    Date.now = realNow;
  }
});

test("toMs sanitizes non-finite values and invalid dates to current timestamp", () => {
  const before = Date.now();
  assert.ok(toMs(NaN) >= before);
  assert.ok(toMs(Infinity) >= before);
  assert.ok(toMs(-Infinity) >= before);
  assert.ok(toMs(new Date("invalid")) >= before);
});

test("doesSubjectNeedDeepFetch keeps matching history across portal days, including subject expansion", () => {
  const row = { subjectcode: "CS101", Lsubjectcomponentid: "lecture", totalclass: 10, totalpresent: 8 };
  const checksum = computeSubjectRowChecksum(row);
  const dummyDetail = { L: { totalclass: 10, totalpresent: 8 } };
  const today = Date.UTC(2026, 9, 7, 8, 30, 0); // 14:00 IST Oct 7
  const yesterday = Date.UTC(2026, 9, 6, 8, 30, 0); // 14:00 IST Oct 6

  // In background sync (default options), identical checksum skips fetch across portal day boundaries
  assert.equal(isCurrentPortalDay(yesterday, today), false);
  assert.equal(doesSubjectNeedDeepFetch(row, dummyDetail, yesterday, checksum, today), false);

  assert.equal(doesSubjectNeedDeepFetch(row, dummyDetail, today, checksum, today), false);

  // If the overview row checksum changed (e.g. a new class was recorded), deep fetch is triggered immediately
  const updatedRow = { ...row, totalclass: 11, totalpresent: 9 };
  assert.equal(doesSubjectNeedDeepFetch(updatedRow, dummyDetail, yesterday, checksum, today), true);
});

test("computeSubjectRowChecksum detects updates in pure-lab Ppercentage even when LTpercantage is 0", () => {
  const lab1 = {
    individualsubjectcode: "CS212",
    Psubjectcomponentid: "comp_p",
    Ppercentage: "80.0",
    LTpercantage: "0",
  };
  const lab2 = {
    individualsubjectcode: "CS212",
    Psubjectcomponentid: "comp_p",
    Ppercentage: "85.0",
    LTpercantage: "0",
  };
  assert.notEqual(computeSubjectRowChecksum(lab1), computeSubjectRowChecksum(lab2));
});

test("subscribePortalDayRollover multiplexes multiple subscribers over a single event dispatch", () => {
  dispatchedEvents = [];
  let countA = 0;
  let countB = 0;
  const unsubA = subscribePortalDayRollover(() => { countA++; });
  const unsubB = subscribePortalDayRollover(() => { countB++; });

  const listeners = docListeners.get("visibilitychange");
  assert.equal(listeners?.size, 1, "binds only a single document visibilitychange listener");

  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 24 * 3600 * 1000;
    for (const cb of listeners) cb();
    assert.equal(countA, 1);
    assert.equal(countB, 1);
    assert.equal(
      dispatchedEvents.filter((e) => e === "juet:refresh-attendance").length,
      1,
      "dispatches juet:refresh-attendance only once across all subscribers"
    );
  } finally {
    Date.now = realNow;
    unsubA();
    unsubB();
  }
  assert.equal(docListeners.get("visibilitychange")?.size ?? 0, 0, "cleans up listener when last subscriber unsubscribes");
});

test("component reassignment invalidates equal-percentage history without treating ID order as a change", () => {
  const row = { subjectid: "component-snapshot", subjectcode: "CS101", Lsubjectcomponentid: "a,b", Lpercentage: 100 };
  const data = { L: { summary: [{ present: "Y" }] } };
  const checksum = computeSubjectRowChecksum(row);
  assert.equal(computeSubjectRowChecksum({ ...row, Lsubjectcomponentid: "b,a" }), checksum);
  const reassigned = { ...row, Lsubjectcomponentid: "a,c" };
  assert.notEqual(computeSubjectRowChecksum(reassigned), checksum);
  assert.equal(doesSubjectNeedDeepFetch(reassigned, data, Date.now(), checksum), true);
});

test("legacy checksum format from prior app versions is treated as fresh when row counts match", () => {
  const row = { subjectid: "legacy-sub", subjectcode: "CS102", Lsubjectcomponentid: "comp1", Lpercentage: 85, Ltotalclass: 20, Ltotalpresent: 17 };
  const data = { L: { summary: [...Array(17).fill({ present: "Y" }), ...Array(3).fill({ present: "N" })] } };
  const legacyChecksum = computeLegacySubjectRowChecksum(row);
  const newChecksum = computeSubjectRowChecksum(row);
  assert.notEqual(legacyChecksum, newChecksum);
  // Matching legacy checksum does not trigger deep fetch if cachedUpdatedAt is valid
  assert.equal(doesSubjectNeedDeepFetch(row, data, Date.now(), legacyChecksum), false);
  // If counts changed, legacy checksum no longer matches and triggers deep fetch
  const changedRow = { ...row, Ltotalclass: 21 };
  assert.equal(doesSubjectNeedDeepFetch(changedRow, data, Date.now(), legacyChecksum), true);
});

test("raw legacy checksum format with string zero component id is treated as fresh", () => {
  const row = {
    subjectid: "legacy-lab",
    subjectcode: "CS103",
    Psubjectcomponentid: "lab1",
    Tsubjectcomponentid: "0",
    Ppercentage: 90,
    totalclass: 10,
    totalpresent: 9,
  };
  const data = { P: { summary: [...Array(9).fill({ present: "Y" }), { present: "N" }] } };
  // Raw legacy computed isLab=false because Boolean("0") === true
  const rawLegacyChecksum = `${row.subjectid}|10|9||::|::|::90`;
  assert.equal(doesSubjectNeedDeepFetch(row, data, Date.now(), rawLegacyChecksum), false);
});

test("unchanged percentage-only history is checked once each portal day", () => {
  const yesterday = Date.UTC(2026, 9, 6, 8, 30);
  const today = yesterday + 86400000;
  const row = { subjectid: "perfect", Lsubjectcomponentid: "lecture", Lpercentage: 100 };
  const data = { L: { summary: [{ present: "Y" }] } };
  const checksum = computeSubjectRowChecksum(row);
  assert.equal(doesSubjectNeedDeepFetch(row, data, today, checksum, today), false);
  assert.equal(doesSubjectNeedDeepFetch(row, data, yesterday, checksum, today), true, "100% does not reveal newly attended classes");
  assert.equal(doesSubjectNeedDeepFetch(row, data, yesterday, null, today), true);
  assert.equal(doesSubjectNeedDeepFetch(row, data, today, null, today), false);
});

test("a matching overview checksum cannot certify contradictory cached history", () => {
  const row = { subjectid: "lagging", Lsubjectcomponentid: "lecture", Lpercentage: 94.4 };
  const data = { L: { totalclass: 32, totalpresent: 30 } };
  const now = Date.now();
  assert.equal(doesSubjectNeedDeepFetch(row, data, now, computeSubjectRowChecksum(row), now), true);
});

test("provisional portal disagreements stay cached today but revalidate next portal day", () => {
  const today = Date.UTC(2026, 9, 7, 8, 30);
  const tomorrow = today + 86400000;
  const data = { L: { totalclass: 32, totalpresent: 30 } };
  for (const counts of [{}, { Ltotalclass: 36, Ltotalpresent: 34 }]) {
    const row = { subjectid: "provisional", Lsubjectcomponentid: "lecture", Lpercentage: 94.4, ...counts };
    const checksum = computeSubjectRowChecksum(row);
    assert.equal(doesSubjectNeedDeepFetch(row, data, today, checksum, today, true), false);
    assert.equal(doesSubjectNeedDeepFetch(row, data, today, checksum, tomorrow, true), true);
    assert.equal(doesSubjectNeedDeepFetch(row, data, today, checksum, today), true, "ordinary mismatched entries still require repair");
    assert.equal(doesSubjectNeedDeepFetch({ ...row, Lpercentage: 95 }, data, today, checksum, today, true), true);
    assert.equal(doesSubjectNeedDeepFetch({ ...row, Lsubjectcomponentid: "replacement" }, data, today, checksum, today, true), true);
  }
});

test("provisional caching still requires complete data, a valid timestamp, and the current checksum", () => {
  const now = Date.UTC(2026, 9, 7, 8, 30);
  const row = { subjectid: "provisional-validation", Lsubjectcomponentid: "lecture", Lpercentage: 94.4 };
  const data = { L: { totalclass: 32, totalpresent: 30 } };
  const checksum = computeSubjectRowChecksum(row);
  assert.equal(doesSubjectNeedDeepFetch(row, {}, now, checksum, now, true), true);
  assert.equal(doesSubjectNeedDeepFetch(row, data, null, checksum, now, true), true);
  assert.equal(doesSubjectNeedDeepFetch(row, data, now, null, now, true), true);
  assert.equal(doesSubjectNeedDeepFetch(row, data, now, computeLegacySubjectRowChecksum(row), now, true), true);
});

test("unknown overview metadata keeps same-day history while invalid timestamps remain stale", () => {
  const row = { subjectid: "unknown", Lsubjectcomponentid: "lecture" };
  const data = { L: { totalclass: 5, totalpresent: 4 } };
  const now = Date.now();
  const checksum = computeSubjectRowChecksum(row);
  assert.equal(doesSubjectNeedDeepFetch(row, data, now, checksum, now), false);
  for (const updatedAt of [null, 0, -1, NaN, Infinity]) {
    assert.equal(doesSubjectNeedDeepFetch(row, data, updatedAt, checksum, now), true);
  }
});

test("subjects without real components can cache their empty result", () => {
  const row = { subjectid: "empty", Lsubjectcomponentid: "0", Tsubjectcomponentid: " null ", Psubjectcomponentid: "undefined" };
  const now = Date.now();
  assert.equal(doesSubjectNeedDeepFetch(row, {}, now, computeSubjectRowChecksum(row), now), false);
  assert.equal(doesSubjectNeedDeepFetch({ ...row, Lsubjectcomponentid: "lecture" }, {}, now, computeSubjectRowChecksum(row), now), true);
});

test("component checksums canonicalize equivalent ID lists and isolate L/T changes", () => {
  const row = { subjectid: "ids", Lsubjectcomponentid: "a,b", Lpercentage: 100, Tsubjectcomponentid: "t", Tpercentage: 100 };
  const equivalent = { ...row, Lsubjectcomponentid: " b, a, a, 0, null, undefined, " };
  assert.equal(computeSubjectRowChecksum(equivalent), computeSubjectRowChecksum(row));
  assert.equal(computeSubjectComponentChecksum(equivalent, "L"), computeSubjectComponentChecksum(row, "L"));
  assert.equal(computeSubjectComponentChecksum({ ...row, Tpercentage: 50 }, "L"), computeSubjectComponentChecksum(row, "L"));
  assert.notEqual(computeSubjectComponentChecksum({ ...row, Lsubjectcomponentid: "c" }, "L"), computeSubjectComponentChecksum(row, "L"));
});

test("count coverage requires valid total and present pairs for all real components or the aggregate", () => {
  const row = { Lsubjectcomponentid: "lecture", Tsubjectcomponentid: "tutorial", Ltotalclass: 5, Ltotalpresent: 4 };
  assert.equal(hasSubjectCountCoverage(row), false);
  assert.equal(hasSubjectCountCoverage({ ...row, Ttotalclass: 0, Ttotalpresent: 0 }), true);
  assert.equal(hasSubjectCountCoverage({ ...row, totalclasses: "7", totalpresents: "5" }), true);
  for (const [totalclass, totalpresent] of [["", 0], [" ", 0], [-1, 0], [5, 6], [5.5, 4], [Infinity, 4], [5, null]]) {
    assert.equal(hasSubjectCountCoverage({ ...row, totalclass, totalpresent }), false);
  }
  assert.equal(hasSubjectCountCoverage({ Lsubjectcomponentid: "0" }), true);
});

test("mixed practical history remains daily unless practical counts are covered separately", () => {
  const yesterday = Date.UTC(2026, 9, 6, 8, 30);
  const today = yesterday + 86400000;
  for (const type of ["L", "T"]) {
    const row = { [`${type}subjectcomponentid`]: "theory", Psubjectcomponentid: "practical", totalclass: 1, totalpresent: 1, [`${type}percentage`]: 100, Ppercentage: 100 };
    const data = { [type]: { totalclass: 1, totalpresent: 1 }, P: { totalclass: 1, totalpresent: 1 } };
    assert.equal(hasSubjectCountCoverage(row), false, "aggregate counts cover theory but say nothing about practical classes");
    assert.equal(doesSubjectNeedDeepFetch(row, data, yesterday, computeSubjectRowChecksum(row), today), true);
    const covered = { ...row, Ptotalclass: 1, Ptotalpresent: 1 };
    assert.equal(hasSubjectCountCoverage(covered), true);
    assert.equal(doesSubjectNeedDeepFetch(covered, data, yesterday, computeSubjectRowChecksum(covered), today), false);
  }
  assert.equal(hasSubjectCountCoverage({ Psubjectcomponentid: "practical", totalclass: 1, totalpresent: 1 }), true);
});

test("count coverage and current checksums recognize the same count aliases as attendance parsing", () => {
  const row = { Lsubjectcomponentid: "lecture", Tsubjectcomponentid: "tutorial", LTotalclass: "5", ltotalpresent: "4", ttotalclass: "2", TTotalpresent: "1" };
  assert.equal(hasSubjectCountCoverage(row), true);
  const aggregate = { Lsubjectcomponentid: "lecture", totalclasses: 7, totalpresents: 5 };
  assert.equal(hasSubjectCountCoverage(aggregate), true);
  assert.notEqual(computeSubjectRowChecksum(aggregate), computeSubjectRowChecksum({ ...aggregate, totalpresents: 6 }));
});

test("previous ID-bearing checksums remain compatible after ID normalization", () => {
  const row = { subjectid: "old-ids", Lsubjectcomponentid: " b,a,a ", Lpercentage: 100, Ltotalclass: 2, Ltotalpresent: 2 };
  const previousChecksum = "old-ids||||2:2:100: b,a,a |:::|:::";
  const data = { L: { totalclass: 2, totalpresent: 2 } };
  const now = Date.now();
  assert.equal(doesSubjectNeedDeepFetch(row, data, now, previousChecksum, now), false);
});


