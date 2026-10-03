export const OFFICIAL_PORTAL_PREFIX = "/officialportal";
export const OFFICIAL_PORTAL_BRIDGE_KEY = "juet.portal.official_bridge.v1";
export const OFFICIAL_PORTAL_UPSTREAM = "https://studentportal.juet.ac.in/studentportal";
export const OFFICIAL_PORTAL_API_UPSTREAM = "https://studentportal.juet.ac.in/StudentPortalAPI";
export const OFFICIAL_PORTAL_API_PROXY = "/api";

export const OFFICIAL_PORTAL_STORAGE_KEYS = [
  "token",
  "Token",
  "accessToken",
  "authToken",
  "jwt",
  "jwttoken",
  "regdata",
  "regData",
  "user",
  "userData",
  "userdata",
  "currentUser",
  "profile",
  "session",
  "sessionData",
  "loginData",
  "studentData",
  "portalUser",
  "username",
  // Exact official keys (case-sensitive, from studentportal main.*.js):
  // Token is read by the auth interceptor, Username/tokendate by refresh,
  // userid/instituteid/membertype/bypassValue by GetNavigation.
  "Username",
  "tokendate",
  "Today_DATE",
  "clientidforlink",
  "usertypeselected",
  "otppwd",
  "activeform",
  "rejectedData",
  "userid",
  "clientid",
  "companyid",
  "membertype",
  "usertype",
  "enrollmentno",
  "name",
  "studentName",
  "instituteid",
  "institutename",
  "institutelist",
  "bypass",
  "bypassValue",
];

export function makeOfficialPortalBootstrapScript() {
  const bridgeKey = JSON.stringify(OFFICIAL_PORTAL_BRIDGE_KEY);
  const storageKeys = JSON.stringify(OFFICIAL_PORTAL_STORAGE_KEYS);
  const upstreamBase = JSON.stringify(OFFICIAL_PORTAL_UPSTREAM);
  const upstreamApi = JSON.stringify(OFFICIAL_PORTAL_API_UPSTREAM);
  const proxyBase = JSON.stringify(OFFICIAL_PORTAL_PREFIX);
  const proxyApi = JSON.stringify(OFFICIAL_PORTAL_API_PROXY);

  return `(() => {
  const BRIDGE_KEY = ${bridgeKey};
  const STORAGE_KEYS = ${storageKeys};
  const UPSTREAM_BASE = ${upstreamBase};
  const UPSTREAM_API = ${upstreamApi};
  const PROXY_BASE = ${proxyBase};
  const PROXY_API = ${proxyApi};

  const raw = (() => {
    try {
      return localStorage.getItem(BRIDGE_KEY) || sessionStorage.getItem(BRIDGE_KEY) || "";
    } catch {
      return "";
    }
  })();
  if (!raw) return;

  let session;
  try {
    session = JSON.parse(raw);
  } catch {
    return;
  }
  if (!session || typeof session !== "object") return;

  const token = String(session.token || "");
  if (!token) return;

  const username = String(session.username || session.enrollmentno || "");
  const enrollment = String(session.enrollmentno || username || "");
  const name = String(session.name || "");
  const userId = String(session.userid || "");
  const clientId = String(session.clientid || "");
  const companyId = String(session.companyid || "");
  const memberType = String(session.membertype || (String(session.username || "").startsWith("P") ? "P" : "S") || "S");
  const userType = memberType === "P" ? "P" : "S";
  const instituteId = session.instituteid == null ? "" : String(session.instituteid);
  const instituteName = session.institutename == null ? "" : String(session.institutename);
  const instituteList = JSON.stringify(Array.isArray(session.institutelist) ? session.institutelist : []);
  const bypass = String(session.bypassValue || session.bypass || "");
  // Exact official login fields: refresh needs Username+tokendate, nav needs
  // userid/instituteid/membertype/bypassValue. tokendate/Today_DATE fall back
  // to "now" when the bridge was written by an older session shape.
  const tokendate = String(session.tokendate || new Date().toString());
  const todayDate = String(Date.now());
  const clientIdForLink = String(session.clientidforlink || clientId || "");
  const payload = JSON.stringify(session);

  const seeds = new Map([
    ["token", token],
    ["Token", token],
    ["accessToken", token],
    ["authToken", token],
    ["jwt", token],
    ["jwttoken", token],
    ["regdata", payload],
    ["regData", payload],
    ["user", payload],
    ["userData", payload],
    ["userdata", payload],
    ["currentUser", payload],
    ["profile", payload],
    ["session", payload],
    ["sessionData", payload],
    ["loginData", payload],
    ["studentData", payload],
    ["portalUser", payload],
    ["username", username],
    ["Username", username],
    ["tokendate", tokendate],
    ["Today_DATE", todayDate],
    ["clientidforlink", clientIdForLink],
    ["usertypeselected", userType],
    ["userid", userId],
    ["clientid", clientId],
    ["companyid", companyId],
    ["membertype", memberType],
    ["usertype", userType],
    ["enrollmentno", enrollment],
    ["name", name],
    ["studentName", name],
    ["instituteid", instituteId],
    ["institutename", instituteName],
    ["institutelist", instituteList],
    ["bypass", bypass],
    ["bypassValue", bypass],
  ]);

  const canonicalForKey = (key) => {
    const exact = seeds.get(String(key));
    if (exact != null && exact !== "") return exact;
    const lower = String(key || "").toLowerCase();
    if (!lower) return null;
    if (lower.includes("token") || lower.includes("jwt")) return token;
    if (lower.includes("regdata") || lower.includes("userdata") || lower.includes("profile") || lower.includes("session") || lower.includes("login") || lower.includes("student")) return payload;
    if (lower.includes("institutelist")) return instituteList;
    if (lower.includes("institutename")) return instituteName || null;
    if (lower.includes("instituteid")) return instituteId || null;
    if (lower.includes("member") || lower.includes("usertype") || lower.includes("role")) return userType;
    if (lower.includes("enrollment")) return enrollment || null;
    if (lower.includes("clientid")) return clientId || null;
    if (lower.includes("userid")) return userId || null;
    if (lower.includes("username") || lower === "user") return username || null;
    if (lower.includes("bypass")) return bypass || null;
    return null;
  };

  const seedStorage = (storage) => {
    if (!storage) return;
    try {
      storage.setItem(BRIDGE_KEY, raw);
      for (const key of STORAGE_KEYS) {
        const value = canonicalForKey(key);
        if (value != null && value !== "") storage.setItem(key, value);
      }
    } catch {
      // ignored
    }
  };

  const storages = [window.localStorage, window.sessionStorage];
  for (const storage of storages) seedStorage(storage);

  const originalGetItem = Storage.prototype.getItem;
  const originalRemoveItem = Storage.prototype.removeItem;
  const originalClear = Storage.prototype.clear;

  Storage.prototype.getItem = function patchedGetItem(key) {
    const existing = originalGetItem.call(this, key);
    if (existing != null && existing !== "") return existing;
    const fallback = canonicalForKey(key);
    return fallback != null ? fallback : existing;
  };

  Storage.prototype.removeItem = function patchedRemoveItem(key) {
    const stringKey = String(key || "");
    const fallback = canonicalForKey(stringKey);
    if (stringKey === BRIDGE_KEY || fallback != null) {
      try {
        const self = this;
        queueMicrotask(() => {
          try {
            if (stringKey === BRIDGE_KEY) self.setItem(BRIDGE_KEY, raw);
            else if (!originalGetItem.call(self, stringKey) && fallback != null && fallback !== "") self.setItem(stringKey, fallback);
          } catch {
            // ignored
          }
        });
      } catch {
        // ignored
      }
      return;
    }
    return originalRemoveItem.call(this, key);
  };

  Storage.prototype.clear = function patchedClear() {
    originalClear.call(this);
    seedStorage(this);
  };

  const rewriteUrl = (value) => {
    const input = String(value || "");
    if (!input) return input;
    if (input.startsWith(UPSTREAM_API)) return input.replace(UPSTREAM_API, PROXY_API);
    if (input.startsWith(UPSTREAM_BASE)) return input.replace(UPSTREAM_BASE, PROXY_BASE);
    if (input.startsWith("/StudentPortalAPI")) return input.replace(/^\\/StudentPortalAPI/, PROXY_API);
    if (input.startsWith("/studentportal")) return input.replace(/^\\/studentportal/, PROXY_BASE);
    return input;
  };

  const isApiUrl = (value) => {
    const input = String(value || "");
    return input.startsWith(PROXY_API) || input.startsWith(UPSTREAM_API) || input.startsWith("/StudentPortalAPI");
  };

  const withAuthHeaders = (headersLike) => {
    const headers = new Headers(headersLike || {});
    const auth = headers.get("Authorization") || "";
    if (!auth.replace(/^Bearer\\s+/i, "").trim()) headers.set("Authorization", "Bearer " + token);
    return headers;
  };

  const nativeFetch = window.fetch ? window.fetch.bind(window) : null;
  if (nativeFetch) {
    window.fetch = (input, init) => {
      if (typeof input === "string") {
        const url = rewriteUrl(input);
        return nativeFetch(url, isApiUrl(url) ? { ...(init || {}), headers: withAuthHeaders(init?.headers) } : init);
      }
      if (input instanceof URL) {
        const url = rewriteUrl(input.toString());
        return nativeFetch(new URL(url, window.location.origin), isApiUrl(url) ? { ...(init || {}), headers: withAuthHeaders(init?.headers) } : init);
      }
      if (input && typeof Request !== "undefined" && input instanceof Request) {
        const url = rewriteUrl(input.url);
        const nextInit = isApiUrl(url)
          ? { ...(init || {}), headers: withAuthHeaders(init?.headers ?? input.headers) }
          : init;
        return nativeFetch(new Request(url, input), nextInit);
      }
      return nativeFetch(input, init);
    };
  }

  const nativeOpen = XMLHttpRequest.prototype.open;
  const nativeSend = XMLHttpRequest.prototype.send;
  const nativeSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function patchedOpen(method, url, ...rest) {
    const rewritten = rewriteUrl(url);
    this.__lazyportalOfficialUrl = rewritten;
    this.__lazyportalOfficialAuth = "";
    return nativeOpen.call(this, method, rewritten, ...rest);
  };

  XMLHttpRequest.prototype.setRequestHeader = function patchedSetRequestHeader(name, value) {
    if (String(name || "").toLowerCase() === "authorization") this.__lazyportalOfficialAuth = String(value || "");
    return nativeSetRequestHeader.call(this, name, value);
  };

  XMLHttpRequest.prototype.send = function patchedSend(body) {
    const auth = String(this.__lazyportalOfficialAuth || "");
    if (isApiUrl(this.__lazyportalOfficialUrl) && !auth.replace(/^Bearer\\s+/i, "").trim()) {
      nativeSetRequestHeader.call(this, "Authorization", "Bearer " + token);
    }
    return nativeSend.call(this, body);
  };

  window.__lazyportalOfficialSession = session;
  window.addEventListener("DOMContentLoaded", () => {
    for (const storage of storages) seedStorage(storage);
  }, { once: true });
  setTimeout(() => {
    for (const storage of storages) seedStorage(storage);
  }, 0);
  setTimeout(() => {
    for (const storage of storages) seedStorage(storage);
  }, 500);
  setTimeout(() => {
    for (const storage of storages) seedStorage(storage);
  }, 1500);
})();`;
}

export function rewriteOfficialPortalText(text) {
  return String(text)
    .replaceAll(`${OFFICIAL_PORTAL_UPSTREAM}/`, `${OFFICIAL_PORTAL_PREFIX}/`)
    .replaceAll(OFFICIAL_PORTAL_UPSTREAM, OFFICIAL_PORTAL_PREFIX)
    .replaceAll(OFFICIAL_PORTAL_API_UPSTREAM, OFFICIAL_PORTAL_API_PROXY)
    .replaceAll("/studentportal/", `${OFFICIAL_PORTAL_PREFIX}/`)
    .replaceAll("/studentportal", OFFICIAL_PORTAL_PREFIX)
    .replaceAll("/StudentPortalAPI/", `${OFFICIAL_PORTAL_API_PROXY}/`)
    .replaceAll("/StudentPortalAPI", OFFICIAL_PORTAL_API_PROXY);
}

export function injectOfficialPortalBootstrap(html) {
  const scriptTag = `<script>${makeOfficialPortalBootstrapScript()}</script>`;
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b([^>]*)>/i, `<head$1>${scriptTag}`);
  }
  if (/<body\b[^>]*>/i.test(html)) {
    return html.replace(/<body\b([^>]*)>/i, `<body$1>${scriptTag}`);
  }
  return `${scriptTag}${html}`;
}

export function transformOfficialPortalText(text, contentType = "") {
  const rewritten = rewriteOfficialPortalText(text);
  return /text\/html|application\/xhtml\+xml/i.test(contentType)
    ? injectOfficialPortalBootstrap(rewritten)
    : rewritten;
}
