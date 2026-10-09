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
  getManualRefreshQuota,
  recordSuccessfulManualRefresh,
  getQuotaStorageKey,
  subscribePortalDayRollover,
  DAILY_MANUAL_REFRESH_LIMIT,
  PORTAL_DAY_CUTOFF_HOUR_IST,
  PORTAL_DAY_CUTOFF_MINUTE_IST,
  FEATURE_TTL,
  computeSubjectRowChecksum,
  doesSubjectNeedDeepFetch,
  REFRESH_THROTTLE_MS,
  shouldThrottleRefresh,
  recordRefreshAttempt,
  getThrottleKey,
} = await import("../src/lib/portalSchedule.ts");

test("portal day cutoff is 02:00 AM IST", () => {
  assert.equal(PORTAL_DAY_CUTOFF_HOUR_IST, 2);
  assert.equal(PORTAL_DAY_CUTOFF_MINUTE_IST, 0);
  assert.equal(DAILY_MANUAL_REFRESH_LIMIT, 1);
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

test("manual refresh quota enforces daily limit and resets automatically on new portal day", () => {
  values.clear();
  dispatchedEvents = [];
  const session = { username: "student123", instituteid: "juet" };
  const day1Time = Date.UTC(2026, 9, 7, 8, 30, 0); // 14:00 IST Oct 7
  const day2Time = Date.UTC(2026, 9, 7, 20, 31, 0); // 02:01 IST Oct 8 (new portal day)

  // Initially full quota
  const initial = getManualRefreshQuota(session, day1Time);
  assert.equal(initial.used, 0);
  assert.equal(initial.remaining, 1);
  assert.equal(initial.canRefresh, true);

  // Unchanged attendance does NOT burn quota
  const noChange = recordSuccessfulManualRefresh(session, { changed: false, now: day1Time });
  assert.equal(noChange.used, 0);
  assert.equal(noChange.remaining, 1);
  assert.equal(noChange.canRefresh, true);

  // Record 1 successful manual refresh when attendance actually changed
  const after1 = recordSuccessfulManualRefresh(session, day1Time);
  assert.equal(after1.used, 1);
  assert.equal(after1.remaining, 0);
  assert.equal(after1.canRefresh, false);
  assert.ok(dispatchedEvents.includes("juet:quota-changed"));

  // Checking quota on same day reports exhausted
  const checkSameDay = getManualRefreshQuota(session, day1Time);
  assert.equal(checkSameDay.used, 1);
  assert.equal(checkSameDay.remaining, 0);
  assert.equal(checkSameDay.canRefresh, false);

  // On day 2 (after 2 AM IST), quota automatically resets!
  const day2Check = getManualRefreshQuota(session, day2Time);
  assert.equal(day2Check.used, 0);
  assert.equal(day2Check.remaining, 1);
  assert.equal(day2Check.canRefresh, true);
});

test("quota is isolated between different students and institutes", () => {
  values.clear();
  const time = Date.UTC(2026, 9, 7, 8, 30, 0);
  const s1 = { username: "student1", instituteid: "juet" };
  const s2 = { username: "student2", instituteid: "juet" };

  recordSuccessfulManualRefresh(s1, time);
  assert.equal(getManualRefreshQuota(s1, time).canRefresh, false);
  assert.equal(getManualRefreshQuota(s2, time).canRefresh, true);
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

  // 8. Explicit subject tap (SubjectDetailSheet) allows deep fetch if not updated today
  assert.equal(doesSubjectNeedDeepFetch(row, dummyDetail, eightDaysAgo, checksum, fixedNow, true), true);
  assert.equal(doesSubjectNeedDeepFetch(row, dummyDetail, fixedNow, checksum, fixedNow, true), false);
});

test("isCurrentPortalDay defaults to now for single-arg freshness checks", () => {
  const now = Date.now();
  assert.equal(isCurrentPortalDay(now), true);
  assert.equal(isCurrentPortalDay(null), false);
  assert.equal(isCurrentPortalDay(undefined), false);

  const yesterday = now - 24 * 3600 * 1000 * 2;
  assert.equal(isCurrentPortalDay(yesterday), false);
});

test("FEATURE_TTL keeps marks cached until explicit refresh", () => {
  assert.equal(FEATURE_TTL.marks, Number.POSITIVE_INFINITY);
  assert.equal(FEATURE_TTL.exams, 24 * 60 * 60 * 1000);
  assert.equal(FEATURE_TTL.faculty, 7 * 24 * 60 * 60 * 1000);
  assert.equal(FEATURE_TTL.subjects, 7 * 24 * 60 * 60 * 1000);
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

test("getManualRefreshQuota sanitizes corrupt localStorage counts and clamps limits", () => {
  const session = { username: "student_corrupt", instituteid: "1" };
  const key = getQuotaStorageKey(session);
  const now = Date.now();
  const day = getPortalDayKey(now);

  // 1. Infinity string or value
  globalThis.localStorage.setItem(key, JSON.stringify({ day, count: "Infinity" }));
  let q = getManualRefreshQuota(session, now);
  assert.equal(q.used, 0);
  assert.equal(q.canRefresh, true);

  // 2. Negative count
  globalThis.localStorage.setItem(key, JSON.stringify({ day, count: -3 }));
  q = getManualRefreshQuota(session, now);
  assert.equal(q.used, 0);
  assert.equal(q.canRefresh, true);

  // 3. Count exceeding DAILY_MANUAL_REFRESH_LIMIT
  globalThis.localStorage.setItem(key, JSON.stringify({ day, count: 999 }));
  q = getManualRefreshQuota(session, now);
  assert.equal(q.used, DAILY_MANUAL_REFRESH_LIMIT);
  assert.equal(q.canRefresh, false);

  // 4. Over-limit calls to recordSuccessfulManualRefresh never exceed DAILY_MANUAL_REFRESH_LIMIT
  const updated = recordSuccessfulManualRefresh(session, now);
  assert.equal(updated.used, DAILY_MANUAL_REFRESH_LIMIT);
  assert.equal(updated.canRefresh, false);
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
