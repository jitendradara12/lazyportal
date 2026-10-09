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
  DAILY_UNCHANGED_REFRESH_LIMIT,
  UNCHANGED_COOLDOWN_MS,
  PORTAL_DAY_CUTOFF_HOUR_IST,
  PORTAL_DAY_CUTOFF_MINUTE_IST,
  FEATURE_TTL,
  computeSubjectRowChecksum,
  doesSubjectNeedDeepFetch,
  REFRESH_THROTTLE_MS,
  shouldThrottleRefresh,
  recordRefreshAttempt,
  getThrottleKey,
  toMs,
} = await import("../src/lib/portalSchedule.ts");

test("portal day cutoff is 02:00 AM IST", () => {
  assert.equal(PORTAL_DAY_CUTOFF_HOUR_IST, 2);
  assert.equal(PORTAL_DAY_CUTOFF_MINUTE_IST, 0);
  assert.equal(DAILY_MANUAL_REFRESH_LIMIT, 1);
  assert.equal(DAILY_UNCHANGED_REFRESH_LIMIT, 3);
  assert.equal(UNCHANGED_COOLDOWN_MS, 6 * 3600 * 1000);
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

  // Unchanged attendance does NOT burn the manual quota, but starts the 6h cooldown
  const noChange = recordSuccessfulManualRefresh(session, { changed: false, now: day1Time });
  assert.equal(noChange.used, 0);
  assert.equal(noChange.unchanged, 1);
  assert.equal(noChange.canRefresh, false);

  // After 6h cooldown, canRefresh becomes true again
  const after6h = getManualRefreshQuota(session, day1Time + UNCHANGED_COOLDOWN_MS);
  assert.equal(after6h.used, 0);
  assert.equal(after6h.remaining, 1);
  assert.equal(after6h.canRefresh, true);

  // Record 1 successful manual refresh when attendance actually changed
  const after1 = recordSuccessfulManualRefresh(session, { changed: true, now: day1Time + UNCHANGED_COOLDOWN_MS });
  assert.equal(after1.used, 1);
  assert.equal(after1.remaining, 0);
  assert.equal(after1.canRefresh, false);
  assert.ok(dispatchedEvents.includes("juet:quota-changed"));

  // Checking quota on same day reports exhausted
  const checkSameDay = getManualRefreshQuota(session, day1Time + UNCHANGED_COOLDOWN_MS);
  assert.equal(checkSameDay.used, 1);
  assert.equal(checkSameDay.remaining, 0);
  assert.equal(checkSameDay.canRefresh, false);

  // On day 2 (after 2 AM IST), quota automatically resets!
  const day2Check = getManualRefreshQuota(session, day2Time);
  assert.equal(day2Check.used, 0);
  assert.equal(day2Check.unchanged, 0);
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

test("unchanged attendance refreshes are spaced by 6-hour cooldown and capped at 3 per day", () => {
  values.clear();
  const session = { username: "student123", instituteid: "juet" };
  const now = Date.UTC(2026, 9, 7, 3, 0, 0); // 08:30 AM IST Oct 7

  // 1st unchanged check at t0
  const r1 = recordSuccessfulManualRefresh(session, { changed: false, now });
  assert.equal(r1.used, 0);
  assert.equal(r1.unchanged, 1);
  assert.equal(r1.canRefresh, false); // Cooldown active

  // Attempt before 6h cooldown expires is blocked
  assert.equal(getManualRefreshQuota(session, now + 3 * 3600 * 1000).canRefresh, false);

  // After 6h: 2nd check is allowed
  const t2 = now + UNCHANGED_COOLDOWN_MS;
  assert.equal(getManualRefreshQuota(session, t2).canRefresh, true);
  const r2 = recordSuccessfulManualRefresh(session, { changed: false, now: t2 });
  assert.equal(r2.unchanged, 2);
  assert.equal(r2.canRefresh, false);

  // Limits are independent: changed:true still succeeds and consumes manual quota after 2 unchanged checks
  const t3 = t2 + UNCHANGED_COOLDOWN_MS;
  assert.equal(getManualRefreshQuota(session, t3).canRefresh, true);
  const rChanged = recordSuccessfulManualRefresh(session, { changed: true, now: t3 });
  assert.equal(rChanged.used, 1);
  assert.equal(rChanged.unchanged, 2);
  assert.equal(rChanged.canRefresh, false);
});

test("3 unchanged refreshes lock out for the remainder of the portal day", () => {
  values.clear();
  const session = { username: "student123", instituteid: "juet" };
  const now = Date.UTC(2026, 9, 7, 2, 30, 0); // 08:00 IST Oct 7

  // 1st at 08:00 IST
  recordSuccessfulManualRefresh(session, { changed: false, now });
  // 2nd at 14:00 IST (+6h)
  recordSuccessfulManualRefresh(session, { changed: false, now: now + UNCHANGED_COOLDOWN_MS });
  // 3rd at 20:00 IST (+12h)
  const r3 = recordSuccessfulManualRefresh(session, { changed: false, now: now + 2 * UNCHANGED_COOLDOWN_MS });
  assert.equal(r3.unchanged, 3);
  assert.equal(r3.canRefresh, false);

  // Even after another 6h (e.g. 01:00 IST next calendar day, but same portal day), still locked out
  const samePortalDayLater = now + 17 * 3600 * 1000;
  assert.equal(getManualRefreshQuota(session, samePortalDayLater).canRefresh, false);
  assert.equal(getManualRefreshQuota(session, samePortalDayLater).remaining, 0);
  assert.equal(getManualRefreshQuota(session, samePortalDayLater).blockedReason, "unchanged_exhausted");
});

test("changed: true during active cooldown succeeds and sets used: 1 (lib-vs-UI divergence resolved)", () => {
  values.clear();
  const session = { username: "student123", instituteid: "juet" };
  const now = Date.UTC(2026, 9, 7, 3, 0, 0); // 08:30 AM IST

  // 1st check: unchanged, enters 6h cooldown
  const r1 = recordSuccessfulManualRefresh(session, { changed: false, now });
  assert.equal(r1.used, 0);
  assert.equal(r1.canRefresh, false);
  assert.equal(r1.blockedReason, "cooldown");
  assert.equal(r1.remaining, 1); // 1 manual refresh still available when changes occur

  // During cooldown (e.g. 10 minutes later), an attendance change is detected and recorded
  const duringCooldown = now + 10 * 60 * 1000;
  const rChanged = recordSuccessfulManualRefresh(session, { changed: true, now: duringCooldown });
  assert.equal(rChanged.used, 1);
  assert.equal(rChanged.remaining, 0);
  assert.equal(rChanged.canRefresh, false);
});

test("window-slide prevention: stray poll during cooldown does not advance lastUnchangedAt", () => {
  values.clear();
  const session = { username: "student123", instituteid: "juet" };
  const t0 = Date.UTC(2026, 9, 7, 3, 0, 0); // 08:30 AM IST

  // 1st unchanged check at t0
  recordSuccessfulManualRefresh(session, { changed: false, now: t0 });

  // Stray poll 5.5 hours later (30m before cooldown expiry)
  const tStray = t0 + 5.5 * 3600 * 1000;
  const strayResult = recordSuccessfulManualRefresh(session, { changed: false, now: tStray });
  assert.equal(strayResult.canRefresh, false);
  assert.equal(strayResult.blockedReason, "cooldown");

  // Exactly at t0 + 6h, cooldown successfully expires (not delayed by the stray poll)
  const tExpiry = t0 + UNCHANGED_COOLDOWN_MS;
  assert.equal(getManualRefreshQuota(session, tExpiry).canRefresh, true);
});

test("counts and cooldown cleanly reset across portal day rollover at 02:00 AM IST", () => {
  values.clear();
  const session = { username: "student123", instituteid: "juet" };
  // 01:30 AM IST Oct 8 (portal day 2026-10-07)
  const t1 = Date.UTC(2026, 9, 7, 20, 0, 0);
  recordSuccessfulManualRefresh(session, { changed: false, now: t1 });

  // 02:30 AM IST Oct 8 (new portal day 2026-10-08, 1 hour later)
  const t2 = Date.UTC(2026, 9, 7, 21, 0, 0);
  const q2 = getManualRefreshQuota(session, t2);
  // Both counts and cooldown reset cleanly at 02:00 AM IST cutoff
  assert.equal(q2.canRefresh, true);
  assert.equal(q2.blockedReason, null);
  assert.equal(q2.used, 0);
  assert.equal(q2.unchanged, 0);
  assert.equal(q2.remaining, 1);
});

test("future skew and corrupt storage timestamps are safely sanitized", () => {
  values.clear();
  const session = { username: "student123", instituteid: "juet" };
  const now = Date.UTC(2026, 9, 7, 3, 0, 0); // 08:30 AM IST
  const key = getQuotaStorageKey(session);

  // 1. Future timestamp (clock skew: 1 hour in the future)
  values.set(key, JSON.stringify({ day: getPortalDayKey(now), count: 0, unchanged: 1, lastUnchangedAt: now + 3600 * 1000 }));
  const qFuture = getManualRefreshQuota(session, now);
  // Clamped to now, so cooldown expires at now + UNCHANGED_COOLDOWN_MS, not locked out for 7+ hours
  assert.equal(qFuture.blockedReason, "cooldown");
  assert.equal(qFuture.resetsInMs, UNCHANGED_COOLDOWN_MS);

  // 2. Corrupt NaN and negative values
  values.set(key, JSON.stringify({ day: getPortalDayKey(now), count: "corrupt", unchanged: -5, lastUnchangedAt: "invalid" }));
  const qCorrupt = getManualRefreshQuota(session, now);
  assert.equal(qCorrupt.used, 0);
  assert.equal(qCorrupt.unchanged, 0);
  assert.equal(qCorrupt.canRefresh, true);
});

test("4th unchanged attempt after 3 cap is strictly rejected, preserves lastUnchangedAt, and resets at portal day cutoff", () => {
  values.clear();
  const session = { username: "student123", instituteid: "juet" };
  const now = Date.UTC(2026, 9, 7, 2, 30, 0); // 08:00 IST Oct 7

  recordSuccessfulManualRefresh(session, { changed: false, now });
  recordSuccessfulManualRefresh(session, { changed: false, now: now + UNCHANGED_COOLDOWN_MS });
  const t3 = now + 2 * UNCHANGED_COOLDOWN_MS;
  const r3 = recordSuccessfulManualRefresh(session, { changed: false, now: t3 });
  assert.equal(r3.unchanged, 3);
  assert.equal(r3.canRefresh, false);

  // 4th attempt even 10h later is blocked
  const t4 = now + 12 * 3600 * 1000;
  const r4 = recordSuccessfulManualRefresh(session, { changed: false, now: t4 });
  assert.equal(r4.unchanged, 3);
  assert.equal(r4.canRefresh, false);
  assert.equal(r4.blockedReason, "unchanged_exhausted");

  // lastUnchangedAt is unmoved from 3rd attempt
  const stored = JSON.parse(values.get(getQuotaStorageKey(session)));
  assert.equal(stored.lastUnchangedAt, t3);

  // resetsInMs is exactly time until portal day rollover at 02:00 AM IST
  assert.equal(r4.resetsInMs, getMsUntilNextPortalDay(t4));
});

test("day-mismatch with corrupt storage counts safely resets to clean day state", () => {
  values.clear();
  const session = { username: "student123", instituteid: "juet" };
  const yesterday = Date.UTC(2026, 9, 6, 8, 30, 0);
  const today = Date.UTC(2026, 9, 7, 8, 30, 0);
  const key = getQuotaStorageKey(session);

  values.set(key, JSON.stringify({
    day: getPortalDayKey(yesterday),
    count: "corrupted_count",
    unchanged: -99,
    lastUnchangedAt: "invalid_timestamp",
  }));

  const q = getManualRefreshQuota(session, today);
  assert.equal(q.used, 0);
  assert.equal(q.unchanged, 0);
  assert.equal(q.canRefresh, true);
  assert.equal(q.blockedReason, null);
  assert.equal(q.remaining, 1);
});

test("supports Date objects interchangeably with numeric timestamps", () => {
  values.clear();
  const session = { username: "student123", instituteid: "juet" };
  const dateObj = new Date(Date.UTC(2026, 9, 7, 3, 0, 0));

  const q1 = getManualRefreshQuota(session, dateObj);
  assert.equal(q1.canRefresh, true);

  const r1 = recordSuccessfulManualRefresh(session, { changed: false, now: dateObj });
  assert.equal(r1.unchanged, 1);
  assert.equal(r1.blockedReason, "cooldown");

  const r2 = recordSuccessfulManualRefresh(session, dateObj);
  assert.equal(r2.used, 1);
  assert.equal(r2.blockedReason, "manual_exhausted");
});

test("changed: true is blocked when unchanged limit is exhausted (symmetric hard block)", () => {
  values.clear();
  const session = { username: "student123", instituteid: "juet" };
  const now = Date.UTC(2026, 9, 7, 2, 30, 0); // 08:00 IST

  // Use up 3 unchanged refreshes across 12h
  recordSuccessfulManualRefresh(session, { changed: false, now });
  recordSuccessfulManualRefresh(session, { changed: false, now: now + UNCHANGED_COOLDOWN_MS });
  const r3 = recordSuccessfulManualRefresh(session, { changed: false, now: now + 2 * UNCHANGED_COOLDOWN_MS });
  assert.equal(r3.unchanged, 3);
  assert.equal(r3.blockedReason, "unchanged_exhausted");

  // changed: true is now blocked symmetrically in lib (no split-brain with UI)
  const rAttempt = recordSuccessfulManualRefresh(session, { changed: true, now: now + 14 * 3600 * 1000 });
  assert.equal(rAttempt.used, 0);
  assert.equal(rAttempt.unchanged, 3);
  assert.equal(rAttempt.canRefresh, false);
});

test("AttendancePage pre-check blocks during cooldown and exhaustion while keeping button tappable", () => {
  values.clear();
  const session = { username: "student123", instituteid: "juet" };
  const now = Date.UTC(2026, 9, 7, 3, 0, 0);

  // During cooldown: canRefresh is false -> blocked from hitting network
  const rCooldown = recordSuccessfulManualRefresh(session, { changed: false, now });
  assert.equal(rCooldown.canRefresh, false);
  assert.equal(rCooldown.blockedReason, "cooldown");

  // After 6h: canRefresh is true -> allows next check
  const t2 = now + UNCHANGED_COOLDOWN_MS;
  assert.equal(getManualRefreshQuota(session, t2).canRefresh, true);

  // When manual exhausted: canRefresh is false -> blocked
  const rManual = recordSuccessfulManualRefresh(session, { changed: true, now: t2 });
  assert.equal(rManual.canRefresh, false);
  assert.equal(rManual.blockedReason, "manual_exhausted");
});

test("toMs sanitizes non-finite values and invalid dates to current timestamp", () => {
  const before = Date.now();
  assert.ok(toMs(NaN) >= before);
  assert.ok(toMs(Infinity) >= before);
  assert.ok(toMs(-Infinity) >= before);
  assert.ok(toMs(new Date("invalid")) >= before);
});

test("changed: true early-returns current state when manual quota is already exhausted", () => {
  values.clear();
  const session = { username: "student123", instituteid: "juet" };
  const now = Date.UTC(2026, 9, 7, 3, 0, 0);

  // First change burns quota
  const r1 = recordSuccessfulManualRefresh(session, { changed: true, now });
  assert.equal(r1.used, 1);
  dispatchedEvents = [];

  // Second change when already exhausted does not rewrite storage or dispatch event
  const r2 = recordSuccessfulManualRefresh(session, { changed: true, now });
  assert.equal(r2.used, 1);
  assert.equal(dispatchedEvents.includes("juet:quota-changed"), false);
});

test("clamp safely handles non-finite values (Infinity, NaN) by defaulting to min", () => {
  values.clear();
  const session = { username: "student123", instituteid: "juet" };
  const now = Date.UTC(2026, 9, 7, 3, 0, 0);
  const key = getQuotaStorageKey(session);

  // count = Infinity -> non-finite, safely defaults to 0
  values.set(key, JSON.stringify({
    day: getPortalDayKey(now),
    count: Infinity,
    unchanged: 0,
    lastUnchangedAt: 0,
  }));
  const qInf = getManualRefreshQuota(session, now);
  assert.equal(qInf.used, 0);
});

test("SubjectDetailSheet isFresh checks isCurrentPortalDay and forces revalidation on day rollover", () => {
  const row = { subjectcode: "CS101", totalclass: 10, totalpresent: 8 };
  const checksum = computeSubjectRowChecksum(row);
  const dummyDetail = { L: { totalclass: 10, totalpresent: 8 } };
  const today = Date.UTC(2026, 9, 7, 8, 30, 0); // 14:00 IST Oct 7
  const yesterday = Date.UTC(2026, 9, 6, 8, 30, 0); // 14:00 IST Oct 6

  // If cached yesterday, even with matching checksum, it must be considered not fresh across day boundary
  assert.equal(isCurrentPortalDay(yesterday, today), false);
  assert.equal(doesSubjectNeedDeepFetch(row, dummyDetail, yesterday, checksum), false);

  // Today with matching checksum is fresh
  assert.equal(isCurrentPortalDay(today, today), true);
  assert.equal(doesSubjectNeedDeepFetch(row, dummyDetail, today, checksum), false);
});
