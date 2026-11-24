import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setImmediate } from "node:timers/promises";
import { createServer } from "vite";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Minimal DOM shim sufficient for mounting React components with effects in Node.
class FakeNode {
  constructor(nodeType) {
    this.nodeType = nodeType;
    this.parentNode = null;
    this.childNodes = [];
    this.ownerDocument = null;
  }
  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    child.ownerDocument = this.ownerDocument;
    this.childNodes.push(child);
    return child;
  }
  insertBefore(child, beforeChild) {
    if (!beforeChild) return this.appendChild(child);
    if (child.parentNode) child.parentNode.removeChild(child);
    const idx = this.childNodes.indexOf(beforeChild);
    if (idx === -1) return this.appendChild(child);
    child.parentNode = this;
    child.ownerDocument = this.ownerDocument;
    this.childNodes.splice(idx, 0, child);
    return child;
  }
  removeChild(child) {
    const idx = this.childNodes.indexOf(child);
    if (idx !== -1) {
      this.childNodes.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }
  get firstChild() {
    return this.childNodes[0] ?? null;
  }
  get textContent() {
    return this.childNodes.map((c) => c.textContent).join("");
  }
  set textContent(v) {
    this.childNodes = v ? [new FakeText(String(v))] : [];
  }
}

class FakeText extends FakeNode {
  constructor(text) {
    super(3);
    this.nodeValue = String(text);
  }
  get textContent() {
    return this.nodeValue;
  }
  set textContent(v) {
    this.nodeValue = String(v);
  }
}

class FakeComment extends FakeNode {
  constructor(text) {
    super(8);
    this.nodeValue = String(text);
  }
  get textContent() {
    return "";
  }
}

class FakeElement extends FakeNode {
  constructor(tagName) {
    super(1);
    this.tagName = String(tagName).toUpperCase();
    this.attributes = new Map();
    this.style = {};
    this._listeners = new Map();
    this.disabled = false;
  }
  setAttribute(k, v) {
    this.attributes.set(k, String(v));
  }
  getAttribute(k) {
    return this.attributes.get(k) ?? null;
  }
  removeAttribute(k) {
    this.attributes.delete(k);
  }
  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) {
    this._listeners.get(type)?.delete(fn);
  }
  dispatchEvent(event) {
    let stopped = false;
    event.target ??= this;
    event.stopPropagation = () => { stopped = true; };
    event.preventDefault ??= () => {};
    let node = this;
    while (node && !stopped) {
      event.currentTarget = node;
      for (const fn of [...(node._listeners?.get(event.type) ?? [])]) {
        fn.call(node, event);
      }
      node = node.parentNode;
    }
    return true;
  }
  findAll(predicate, acc = []) {
    if (predicate(this)) acc.push(this);
    for (const child of this.childNodes) {
      if (child instanceof FakeElement) child.findAll(predicate, acc);
    }
    return acc;
  }
  click() {
    this.dispatchEvent({ type: "click", bubbles: true });
  }
}

const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
  clear: () => storage.clear(),
  get length() {
    return storage.size;
  },
  key: (i) => [...storage.keys()][i] ?? null,
};

const windowTarget = new EventTarget();
const docTarget = new EventTarget();
let docVisibilityState = "visible";
let navigatorOnline = true;

const docAttributes = new Map();
globalThis.document = {
  nodeType: 9,
  activeElement: null,
  visibilityState: "visible",
  documentElement: Object.assign(new FakeElement("html"), {
    setAttribute: (k, v) => docAttributes.set(k, String(v)),
    getAttribute: (k) => docAttributes.get(k) ?? null,
  }),
  createElement(tag) {
    const el = new FakeElement(tag);
    el.ownerDocument = globalThis.document;
    return el;
  },
  createElementNS(_ns, tag) {
    const el = new FakeElement(tag);
    el.ownerDocument = globalThis.document;
    return el;
  },
  createTextNode(text) {
    const t = new FakeText(text);
    t.ownerDocument = globalThis.document;
    return t;
  },
  createComment(text) {
    const c = new FakeComment(text);
    c.ownerDocument = globalThis.document;
    return c;
  },
  querySelector: () => null,
  addEventListener: docTarget.addEventListener.bind(docTarget),
  removeEventListener: docTarget.removeEventListener.bind(docTarget),
  dispatchEvent: docTarget.dispatchEvent.bind(docTarget),
};
Object.defineProperty(globalThis.document, "visibilityState", {
  get: () => docVisibilityState,
  configurable: true,
});

Object.defineProperty(globalThis.navigator, "onLine", {
  get: () => navigatorOnline,
  configurable: true,
});

globalThis.window = {
  navigator: globalThis.navigator,
  document: globalThis.document,
  localStorage: globalThis.localStorage,
  location: { origin: "http://localhost:5173" },
  history: { state: null, pushState() {}, back() {}, scrollRestoration: "auto" },
  HTMLIFrameElement: function HTMLIFrameElement() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  setTimeout: globalThis.setTimeout.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis),
  addEventListener: windowTarget.addEventListener.bind(windowTarget),
  removeEventListener: windowTarget.removeEventListener.bind(windowTarget),
  dispatchEvent: windowTarget.dispatchEvent.bind(windowTarget),
};

if (!globalThis.CustomEvent) {
  globalThis.CustomEvent = class CustomEvent extends Event {
    constructor(type, init) {
      super(type, init);
      this.detail = init?.detail;
    }
  };
}

const react = await import("react");
const { act, createElement } = react;
const { createRoot } = await import("react-dom/client");

let server;
let cacheDir;
let AttendancePage, SubjectDetailSheet, useSession;
let sessionCacheKey, setCached, invalidateCacheGeneration, getCacheGeneration;
let client, store, setSessionStatus, transport;
let syncAttendanceDetails, getSubjectCacheKey, getCachedSubjectDetailEntry;

before(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), "attendance-lifecycle-"));
  server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    cacheDir,
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: "custom",
  });
  ({ AttendancePage } = await server.ssrLoadModule("/src/pages/AttendancePage.tsx"));
  ({ SubjectDetailSheet } = await server.ssrLoadModule("/src/components/SubjectDetailSheet.tsx"));
  ({ useSession } = await server.ssrLoadModule("/src/hooks/useSession.ts"));
  ({ sessionCacheKey, setCached, invalidateCacheGeneration, getCacheGeneration } = await server.ssrLoadModule("/src/hooks/useFeature.ts"));
  ({ client, store, setSessionStatus, transport } = await server.ssrLoadModule("/src/lib/portal.ts"));
  ({ syncAttendanceDetails, getSubjectCacheKey, getCachedSubjectDetailEntry } = await server.ssrLoadModule("/src/lib/attendanceSync.ts"));
});

after(async () => {
  await server?.close();
  if (cacheDir) await rm(cacheDir, { recursive: true, force: true });
});

let originalPost, originalPostRaw, originalUsesProxyFor;
beforeEach(() => {
  storage.clear();
  invalidateCacheGeneration();
  docVisibilityState = "visible";
  navigatorOnline = true;
  setSessionStatus("authenticated");
  originalPost = client.post;
  originalPostRaw = client.postRaw;
  originalUsesProxyFor = transport.usesProxyFor;
  client.postRaw = async () => ({
    response: {
      headerlist: [{ stynumber: "4" }],
      semlist: [{ registrationid: "sem1", registrationcode: "2026ODDSEM", registrationdesc: "Odd 2026" }],
    },
  });
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeSession(overrides = {}) {
  return {
    username: "student-1",
    enrollmentno: "student-1",
    instituteid: "inst-1",
    institutename: "Campus 1",
    name: "Test Student",
    membertype: "S",
    token: "token-1",
    tokendate: "Sat Nov 14 2026",
    ...overrides,
  };
}

function seedOverview(session, rows, updatedAt = Date.now()) {
  const semesters = [{ registrationid: "sem1", registrationcode: "2026ODDSEM", registrationdesc: "Odd 2026" }];
  setCached(sessionCacheKey("att.initial", session), {
    header: { stynumber: "4" },
    semesters,
    rows,
  });
  // Overwrite updatedAt if explicitly requested
  if (updatedAt !== undefined) {
    const key = `juet.cache.${sessionCacheKey("att.initial", session)}`;
    const parsed = JSON.parse(storage.get(key));
    parsed.updatedAt = updatedAt;
    storage.set(key, JSON.stringify(parsed));
  }
  storage.set(`juet.portal.sem.${sessionCacheKey("semester", session, "attendance")}`, "sem1");
  return semesters;
}

const logs = (total, present = total) => ({
  summary: Array.from({ length: total }, (_, i) => ({
    present: i < present ? "Y" : "N",
    datetime: `${String(i + 1).padStart(2, "0")}/10/2026 09:00 AM`,
  })),
});

async function mount(element) {
  const container = globalThis.document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  return {
    container,
    root,
    async rerender(nextElement) {
      await act(async () => {
        root.render(nextElement);
      });
    },
    async unmount() {
      await act(async () => {
        root.unmount();
      });
    },
  };
}

async function flush() {
  await act(async () => {
    await setImmediate();
    await setImmediate();
  });
}

test("1. SubjectDetailSheet releases pauseAttendanceSync after a failed detail read and pauses again on retry", async () => {
  const session = makeSession({ username: "sheet-err-user" });
  const row0 = { subjectid: "s0", subjectcode: "Algorithms(CS101)", Lsubjectcomponentid: "l0", Lpercentage: 100 };
  const row1 = { subjectid: "s1", subjectcode: "Networks(CS102)", Lsubjectcomponentid: "l1", Lpercentage: 100 };
  const base = { registrationid: "sem1", registrationcode: "2026ODDSEM" };

  let failS0 = true;
  const s0RetryGate = deferred();
  const s1Gate = deferred();
  const reads = [];

  client.post = async (_endpoint, payload) => {
    reads.push(payload.subjectid);
    if (payload.subjectid === "s0") {
      if (failS0) throw Object.assign(new Error("Service unavailable"), { status: 503 });
      await s0RetryGate.promise;
      return { response: logs(2) };
    }
    await s1Gate.promise;
    return { response: logs(2) };
  };

  const mounted = await mount(
    createElement(SubjectDetailSheet, {
      row: row0,
      registrationid: base.registrationid,
      registrationcode: base.registrationcode,
      session,
      onClose() {},
      onLogout() {},
    }),
  );

  try {
    await flush();
    assert.match(mounted.container.textContent, /JUET's portal is down|Service unavailable/);
    assert.deepEqual(reads, ["s0"]);

    // Background sync for another subject must NOT stay paused while the failed sheet stays open.
    const bgSync = syncAttendanceDetails({ session, rows: [row1], base });
    await setImmediate();
    assert.deepEqual(reads, ["s0", "s1"], "background sync must not be held paused by a failed SubjectDetailSheet");
    s1Gate.resolve();
    assert.equal((await bgSync).complete, true);

    // Clicking Retry pauses background sync again while retrying.
    failS0 = false;
    const retryBtn = mounted.container.findAll(
      (el) => el.tagName === "BUTTON" && el.textContent.includes("Retry"),
    )[0];
    assert.ok(retryBtn, "Retry button should be rendered");

    await act(async () => {
      retryBtn.click();
    });

    const row2 = { subjectid: "s2", subjectcode: "OS(CS103)", Lsubjectcomponentid: "l2", Lpercentage: 100 };
    const pausedSync = syncAttendanceDetails({ session, rows: [row2], base });
    await setImmediate();
    assert.equal(reads.includes("s2"), false, "background sync should pause while retrying SubjectDetailSheet");

    s0RetryGate.resolve();
    await flush();
    await setImmediate();
    assert.equal(reads.includes("s2"), true, "background sync resumes once retry completes");
    await pausedSync;
  } finally {
    s0RetryGate.resolve();
    s1Gate.resolve();
    client.post = originalPost;
    transport.usesProxyFor = originalUsesProxyFor;
    await mounted.unmount();
  }
});

test("2. AttendancePage updates row details from juet:cache-updated after sheet closes and ignores unrelated keys", async () => {
  const session = makeSession({ username: "cache-sync-user" });
  const row0 = { subjectid: "s0", subjectcode: "Compilers", Lsubjectcomponentid: "l0" };
  seedOverview(session, [row0]);

  const sheetGate = deferred();
  // Seed a cached detail for s0 only after simulating background completion post-sheet-close.
  client.post = async () => {
    await sheetGate.promise;
    return { response: logs(4, 3) };
  };

  // Prevent auto-sync from fetching s0 on mount by checking when no Lpercentage/counts exist?
  // Note: s0 has Lsubjectcomponentid: "l0" so auto-sync would fetch it; use AttendancePage with
  // a deferred post that rejects once, OR test juet:cache-updated after auto-sync fails/cancels.
  let rejectSync = true;
  client.post = async () => {
    if (rejectSync) throw Object.assign(new Error("Offline"), { code: "NETWORK_ERROR" });
    return { response: logs(4, 3) };
  };

  const mounted = await mount(
    createElement(AttendancePage, { session, onLogout() {} }),
  );

  try {
    await flush();
    assert.match(mounted.container.textContent, /Tap for history/);

    // Dispatch juet:cache-updated for another user / institute / semester / pending key: must be ignored.
    const otherUserKey = getSubjectCacheKey("other-user", "sem1", row0, session.instituteid);
    const otherSemKey = getSubjectCacheKey(session.username, "sem2", row0, session.instituteid);
    const pendingKey = sessionCacheKey("att.subject.pending", session, "sem1", "s0");
    await act(async () => {
      setCached(otherUserKey, { L: logs(2, 2) });
      setCached(otherSemKey, { L: logs(2, 2) });
      setCached(pendingKey, { L: logs(2, 2) });
    });
    assert.match(mounted.container.textContent, /Tap for history/);

    // Now simulate a SubjectDetailSheet read completing after the sheet closed.
    const targetKey = getSubjectCacheKey(session.username, "sem1", row0, session.instituteid);
    await act(async () => {
      setCached(targetKey, { L: logs(4, 3) }, { checksum: "c0" });
    });

    assert.doesNotMatch(mounted.container.textContent, /Tap for history/);
    assert.match(mounted.container.textContent, /3\/4 classes/);
  } finally {
    sheetGate.resolve();
    client.post = originalPost;
    transport.usesProxyFor = originalUsesProxyFor;
    await mounted.unmount();
  }
});

test("3a. AttendancePage auto-resumes failed/partial detail sync on visibilitychange->visible without retry loops", async () => {
  transport.usesProxyFor = async () => false;
  const session = makeSession({ username: "vis-resume-user" });
  const rows = [
    { subjectid: "s0", subjectcode: "DSA(CS201)", Lsubjectcomponentid: "l0", Lpercentage: 100 },
    { subjectid: "s1", subjectcode: "DBMS(CS202)", Lsubjectcomponentid: "l1", Lpercentage: 100 },
  ];
  seedOverview(session, rows);

  let mode = "fail-s1";
  const reads = [];
  client.post = async (_endpoint, payload) => {
    reads.push(payload.subjectid);
    if (payload.subjectid === "s1" && mode !== "ok") {
      throw Object.assign(new Error("Unavailable"), { status: 503 });
    }
    return { response: logs(2, 2) };
  };

  docVisibilityState = "hidden";
  const mounted = await mount(
    createElement(AttendancePage, { session, onLogout() {} }),
  );

  try {
    await flush();
    assert.deepEqual(reads, ["s0", "s1"]);
    assert.match(mounted.container.textContent, /Some class details could not be updated/);

    // Returning visible while still failing should retry ONCE, fail while visible, and NOT loop.
    docVisibilityState = "visible";
    await act(async () => {
      globalThis.document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush();
    assert.deepEqual(reads, ["s0", "s1", "s1"], "must retry only missing subject s1 once");
    assert.match(mounted.container.textContent, /Some class details could not be updated/);

    // A spurious visibilitychange while already visible must not loop.
    await act(async () => {
      globalThis.document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush();
    assert.deepEqual(reads, ["s0", "s1", "s1"]);

    // Backgrounding again and returning once portal recovers finishes remaining s1.
    docVisibilityState = "hidden";
    await act(async () => {
      globalThis.document.dispatchEvent(new Event("visibilitychange"));
    });
    mode = "ok";
    docVisibilityState = "visible";
    await act(async () => {
      globalThis.document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush();
    assert.deepEqual(reads, ["s0", "s1", "s1", "s1"]);
    assert.doesNotMatch(mounted.container.textContent, /Some class details could not be updated/);
    assert.match(mounted.container.textContent, /2\/2 classes/);
  } finally {
    client.post = originalPost;
    transport.usesProxyFor = originalUsesProxyFor;
    await mounted.unmount();
  }
});

test("3b. AttendancePage auto-resumes on online and avoids double-retrying att.error alongside SectionError", async () => {
  const session = makeSession({ username: "online-att-err-user" });
  const attErrKey = sessionCacheKey("att.initial", session);
  let overviewCalls = 0;
  let failOverview = true;
  client.post = async (endpoint) => {
    if (endpoint.includes("getstudentattendancedetail")) {
      overviewCalls++;
      if (failOverview) {
        const err = new Error("You are offline");
        err.code = "NETWORK_ERROR";
        throw err;
      }
      return {
        response: {
          studentattendancelist: [],
        },
      };
    }
    return { response: {} };
  };

  navigatorOnline = false;
  const mounted = await mount(
    createElement(AttendancePage, { session, onLogout() {} }),
  );

  try {
    await flush();
    assert.equal(overviewCalls, 1);
    assert.match(mounted.container.textContent, /You are offline/);

    // Coming online fires SectionError's online listener AND AttendancePage's online listener:
    // att.retry() must trigger only ONE overview retry (not 2).
    failOverview = false;
    navigatorOnline = true;
    await act(async () => {
      globalThis.window.dispatchEvent(new Event("online"));
    });
    await flush();
    assert.equal(overviewCalls, 2, `expected exactly 1 retry (total 2 calls), got ${overviewCalls} (${attErrKey})`);
    assert.doesNotMatch(mounted.container.textContent, /You are offline/);
  } finally {
    client.post = originalPost;
    transport.usesProxyFor = originalUsesProxyFor;
    client.postRaw = originalPostRaw;
    await mounted.unmount();
  }
});

test("4. AttendancePage re-evaluates auto-sync after manual refresh ends without clobbering refreshError", async () => {
  transport.usesProxyFor = async () => false;
  const session = makeSession({ username: "manual-refresh-user" });
  const rows = [
    { subjectid: "s0", subjectcode: "Math(MA101)", Lsubjectcomponentid: "l0", Lpercentage: 100 },
    { subjectid: "s1", subjectcode: "Physics(PH101)", Lsubjectcomponentid: "l1", Lpercentage: 100 },
  ];
  seedOverview(session, rows);

  // Pre-cache s0 so only s1 needs deep fetch.
  setCached(getSubjectCacheKey(session.username, "sem1", rows[0], session.instituteid), { L: logs(2, 2) }, {
    checksum: (await server.ssrLoadModule("/src/lib/portalSchedule.ts")).computeSubjectRowChecksum(rows[0]),
  });

  // Fail initial auto-sync for s1, then test manual refresh failing vs succeeding.
  let scenario = "fail-initial";
  const detailCalls = [];
  client.post = async (endpoint, payload) => {
    if (endpoint.includes("getstudentattendancedetail")) {
      if (scenario === "manual-fail") throw new Error("Manual overview failed");
      return {
        response: {
          studentattendancelist: rows,
        },
      };
    }
    detailCalls.push(payload.subjectid);
    if (scenario === "fail-initial") throw Object.assign(new Error("Unavailable"), { status: 503 });
    return { response: logs(3, 3) };
  };

  const mounted = await mount(
    createElement(AttendancePage, { session, onLogout() {} }),
  );

  try {
    await flush();
    assert.deepEqual(detailCalls, ["s1"]);

    // 4a: Manual refresh fails and sets refreshError -> auto-sync must NOT run and clobber refreshError.
    scenario = "manual-fail";
    const refreshBtn = mounted.container.findAll(
      (el) => el.tagName === "BUTTON" && el.getAttribute("aria-label") === "Refresh attendance",
    )[0];
    assert.ok(refreshBtn, "Refresh button should exist");

    await act(async () => {
      refreshBtn.click();
    });
    await flush();
    assert.match(mounted.container.textContent, /Manual overview failed/);
    assert.deepEqual(detailCalls, ["s1"], "auto-sync must not run while refreshError is visible");

    // 4b: Next manual refresh after throttle window clears refreshError and completes remaining subject s1.
    const realNow = Date.now;
    Date.now = () => realNow() + 120_000;
    try {
      scenario = "ok";
      await act(async () => {
        refreshBtn.click();
      });
      await flush();
      assert.doesNotMatch(mounted.container.textContent, /Manual overview failed/);
      assert.equal(detailCalls.filter((id) => id === "s1").length >= 2, true);
    } finally {
      Date.now = realNow;
    }
  } finally {
    client.post = originalPost;
    transport.usesProxyFor = originalUsesProxyFor;
    client.postRaw = originalPostRaw;
    await mounted.unmount();
  }
});

test("4b. AttendancePage re-runs auto-sync for remaining subjects when handleRefresh finishes early without refreshError", async () => {
  transport.usesProxyFor = async () => false;
  const session = makeSession({ username: "manual-early-exit-user" });
  const rows = [
    { subjectid: "s0", subjectcode: "Math(MA101)", Lsubjectcomponentid: "l0", Lpercentage: 100 },
  ];
  seedOverview(session, rows);

  // Fail initial auto-sync so s0 remains unsynced.
  let failDetail = true;
  const detailReads = [];
  client.post = async (endpoint, payload) => {
    if (endpoint.includes("getstudentattendancedetail")) {
      return { response: { studentattendancelist: rows } };
    }
    detailReads.push(payload.subjectid);
    if (failDetail) throw Object.assign(new Error("Unavailable"), { status: 503 });
    return { response: logs(2, 2) };
  };

  const mounted = await mount(
    createElement(AttendancePage, { session, onLogout() {} }),
  );

  try {
    await flush();
    assert.deepEqual(detailReads, ["s0"]);

    // Make s0 succeed and start a manual refresh that returns early due to throttle
    // (manualController clears without refreshError or isRefreshing changing):
    // auto-sync re-evaluates via manualRefreshSeq and syncs s0.
    failDetail = false;
    storage.set(`juet.portal.last_refresh_${sessionCacheKey("refresh.attendance", session)}`, String(Date.now()));
    const refreshBtn = mounted.container.findAll(
      (el) => el.tagName === "BUTTON" && el.getAttribute("aria-label") === "Refresh attendance",
    )[0];
    await act(async () => {
      refreshBtn.click();
    });
    await flush();
    assert.deepEqual(detailReads, ["s0", "s0"]);
    assert.match(mounted.container.textContent, /2\/2 classes/);
  } finally {
    client.post = originalPost;
    transport.usesProxyFor = originalUsesProxyFor;
    client.postRaw = originalPostRaw;
    await mounted.unmount();
  }
});

test("5. Silent token renewal (juet:renewed) updates session.token and does NOT abort in-flight syncAttendanceDetails", async () => {
  transport.usesProxyFor = async () => false;
  const session = makeSession({ username: "renew-inflight-user", token: "old-token" });
  store.save(session);
  const rows = [
    { subjectid: "s0", subjectcode: "Networks(CS301)", Lsubjectcomponentid: "l0", Lpercentage: 100 },
  ];
  seedOverview(session, rows);

  const detailGate = deferred();
  let abortedDuringFetch = false;
  let fetchCount = 0;
  client.post = async (_endpoint, _payload, opts) => {
    fetchCount++;
    opts?.signal?.addEventListener("abort", () => {
      abortedDuringFetch = true;
    });
    await detailGate.promise;
    return { response: logs(5, 4) };
  };

  let sessionSeen = null;
  function Harness() {
    const { session: liveSession, logout } = useSession();
    sessionSeen = liveSession;
    return liveSession ? createElement(AttendancePage, { session: liveSession, onLogout: logout }) : null;
  }

  const mounted = await mount(createElement(Harness));

  try {
    await flush();
    assert.equal(fetchCount, 1);
    assert.equal(abortedDuringFetch, false);
    assert.equal(sessionSeen.token, "old-token");

    // Dispatch silent token renewal (new object reference, new token & tokendate)
    const renewed = { ...session, token: "new-token", tokendate: "Sun Nov 15 2026" };
    store.save(renewed);
    await act(async () => {
      globalThis.window.dispatchEvent(new CustomEvent("juet:renewed", { detail: renewed }));
    });
    await flush();

    assert.equal(sessionSeen.token, "new-token", "useSession must propagate renewed token so callers like institute switch preserve it");
    assert.equal(abortedDuringFetch, false, "juet:renewed must NOT abort in-flight syncAttendanceDetails");
    assert.equal(fetchCount, 1, "must not restart a second sync wave");

    detailGate.resolve();
    await flush();
    assert.match(mounted.container.textContent, /4\/5 classes/);

    // Also test AttendancePage directly receiving a new session object ref with same identity & new token
    const row1 = { subjectid: "s1", subjectcode: "Security(CS302)", Lsubjectcomponentid: "l1", Lpercentage: 100 };
    const gate2 = deferred();
    let aborted2 = false;
    let count2 = 0;
    const directSession = makeSession({ username: "direct-prop-user", token: "tok-a" });
    seedOverview(directSession, [row1]);
    client.post = async (_endpoint, _payload, opts) => {
      count2++;
      opts?.signal?.addEventListener("abort", () => { aborted2 = true; });
      await gate2.promise;
      return { response: logs(2, 2) };
    };
    await mounted.rerender(createElement(AttendancePage, { session: directSession, onLogout() {} }));
    await flush();
    assert.equal(count2, 1);
    await mounted.rerender(createElement(AttendancePage, { session: { ...directSession, token: "tok-b" }, onLogout() {} }));
    await flush();
    assert.equal(aborted2, false, "AttendancePage sync effect must not abort on token-only prop change");
    assert.equal(count2, 1);
    gate2.resolve();
    await flush();
  } finally {
    detailGate.resolve();
    client.post = originalPost;
    transport.usesProxyFor = originalUsesProxyFor;
    await mounted.unmount();
  }
});

test("6. AttendancePage never renders a semester selector and completes manual refresh across latest-semester rollover", async () => {
  transport.usesProxyFor = async () => false;
  const session = makeSession({ username: "rollover-user" });
  const oldRow = { subjectid: "s-old", subjectcode: "Old Subject(OS100)", Lsubjectcomponentid: "l-old", Lpercentage: 100 };
  const newRow = { subjectid: "s-new", subjectcode: "New Subject(NS200)", Lsubjectcomponentid: "l-new", Lpercentage: 100 };
  seedOverview(session, [oldRow]);
  // Pre-seed oldRow's detail so initial mount is idle, and expire att.lov so manual refresh re-reads LOV.
  setCached(getSubjectCacheKey(session.username, "sem1", oldRow, session.instituteid), { L: logs(2, 2) }, {
    checksum: (await server.ssrLoadModule("/src/lib/portalSchedule.ts")).computeSubjectRowChecksum(oldRow),
  });
  storage.delete(`juet.cache.${sessionCacheKey("att.lov", session)}`);

  let rolledOver = false;
  client.postRaw = async () => ({
    response: {
      headerlist: [{ stynumber: "4" }],
      semlist: rolledOver
        ? [
            { registrationid: "sem2", registrationcode: "2027EVENSEM", registrationdesc: "Even 2027" },
            { registrationid: "sem1", registrationcode: "2026ODDSEM", registrationdesc: "Odd 2026" },
          ]
        : [
            { registrationid: "sem1", registrationcode: "2026ODDSEM", registrationdesc: "Odd 2026" },
            { registrationid: "sem0", registrationcode: "2026EVENSEM", registrationdesc: "Even 2026" },
          ],
    },
  });
  client.post = async (endpoint, payload) => {
    if (endpoint.includes("getstudentattendancedetail")) {
      return {
        response: {
          studentattendancelist: payload.registrationid === "sem2" ? [newRow] : [oldRow],
        },
      };
    }
    return { response: logs(3, 3) };
  };

  const mounted = await mount(createElement(AttendancePage, { session, onLogout() {} }));
  try {
    await flush();
    assert.match(mounted.container.textContent, /Old Subject/);
    assert.equal(mounted.container.findAll((el) => el.tagName === "SELECT").length, 0);

    rolledOver = true;
    const refreshBtn = mounted.container.findAll(
      (el) => el.tagName === "BUTTON" && el.getAttribute("aria-label") === "Refresh attendance",
    )[0];
    await act(async () => {
      refreshBtn.click();
    });
    await flush();

    assert.match(mounted.container.textContent, /New Subject/);
    assert.match(mounted.container.textContent, /3\/3 classes/);
    assert.doesNotMatch(mounted.container.textContent, /Old Subject/);
    assert.equal(mounted.container.findAll((el) => el.tagName === "SELECT").length, 0);
  } finally {
    client.post = originalPost;
    transport.usesProxyFor = originalUsesProxyFor;
    client.postRaw = originalPostRaw;
    await mounted.unmount();
  }
});

test("7. Proxy mode skips background detail sync on mount, resume, and manual refresh while on-demand SubjectDetailSheet still fetches", async () => {
  const session = makeSession({ username: "proxy-on-demand-user" });
  const rows = [
    { subjectid: "s0", subjectcode: "Algorithms(CS401)", Lsubjectcomponentid: "l0", Lpercentage: 90 },
    { subjectid: "s1", subjectcode: "Compilers(CS402)", Lsubjectcomponentid: "l1", Lpercentage: 85 },
  ];
  seedOverview(session, rows);

  let overviewCalls = 0;
  const detailCalls = [];
  client.post = async (endpoint, payload) => {
    if (endpoint.includes("getstudentattendancedetail")) {
      overviewCalls++;
      return { response: { studentattendancelist: rows } };
    }
    detailCalls.push(payload.subjectid);
    return { response: logs(4, 3) };
  };

  const mounted = await mount(createElement(AttendancePage, { session, onLogout() {} }));
  try {
    await flush();
    assert.deepEqual(detailCalls, [], "proxy mode must not fan out background detail sync on mount");

    // visibilitychange and online must not trigger background detail sync in proxy mode
    docVisibilityState = "hidden";
    await act(async () => {
      globalThis.document.dispatchEvent(new Event("visibilitychange"));
    });
    docVisibilityState = "visible";
    await act(async () => {
      globalThis.document.dispatchEvent(new Event("visibilitychange"));
      globalThis.window.dispatchEvent(new Event("online"));
    });
    await flush();
    assert.deepEqual(detailCalls, [], "proxy mode must not fan out background detail sync on resume");

    // Manual refresh must run only the 1-call overview without fanning out detail requests
    const refreshBtn = mounted.container.findAll(
      (el) => el.tagName === "BUTTON" && el.getAttribute("aria-label") === "Refresh attendance",
    )[0];
    assert.ok(refreshBtn, "Refresh button should exist");
    await act(async () => {
      refreshBtn.click();
    });
    await flush();
    assert.equal(overviewCalls, 1, "manual refresh should refresh the overview once");
    assert.deepEqual(detailCalls, [], "manual refresh in proxy mode must not fan out subject detail reads");

    // Tapping a subject row opens SubjectDetailSheet and fetches only that subject on demand
    const s0Row = mounted.container.findAll(
      (el) => el.tagName === "BUTTON" && (el.getAttribute("aria-label") || "").includes("Algorithms"),
    )[0];
    assert.ok(s0Row, "Algorithms row button should exist");
    await act(async () => {
      s0Row.click();
    });
    await flush();
    // Wait a tick for lazy SubjectDetailSheet Suspense resolution if needed
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    await flush();
    assert.deepEqual(detailCalls, ["s0"], "tapping a subject must fetch only that subject on demand");
    assert.match(mounted.container.textContent, /3\/4 classes/);
  } finally {
    client.post = originalPost;
    client.postRaw = originalPostRaw;
    transport.usesProxyFor = originalUsesProxyFor;
    await mounted.unmount();
  }
});
