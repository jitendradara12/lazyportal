(function officialPortalRuntime(config) {
  "use strict";
  const bridge = window.OfficialPortalNative;
  if (!bridge) throw new Error("Official portal transport unavailable");
  // This origin is reserved for the isolated view. Never clear the main app's
  // origin, cookies, WebStorage globally, or remembered credentials.
  for (const storage of [localStorage, sessionStorage]) {
    storage.clear();
    for (const [key, value] of Object.entries(config.storage)) storage.setItem(key, value);
  }
  const pending = new Map();
  const nonce = Array.from(crypto.getRandomValues(new Uint32Array(4))).join("-");
  let sequence = 0;
  const notify = (event) => bridge.postMessage(JSON.stringify({ event }));
  let expired = false;
  const expire = () => {
    if (expired) return;
    expired = true;
    notify("expired");
  };
  const fail = (message) => new TypeError(message);
  const apiPath = (value) => {
    const url = new URL(value, location.href);
    if (![config.origin, config.upstream].includes(url.origin) || url.username || url.password) return null;
    return url.pathname.startsWith(config.apiPrefix) ? url.pathname.slice(config.apiPrefix.length - 1) : null;
  };
  const decode = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  // Hide forms/actions from navigation; enforcement is still in Android.
  const pruneMenu = (items) => Array.isArray(items) ? items.flatMap((item) => {
    const children = pruneMenu(item.children);
    const route = String(item.url || "").replace(/^\/?(?:#\/)?/, "").replace(/\/$/, "");
    if (children.length) return [{ ...item, children }];
    return config.routes.includes(route) ? [{ ...item, children: [] }] : [];
  }) : [];
  bridge.onmessage = (event) => {
    let reply;
    try { reply = JSON.parse(event.data); } catch { return; }
    const request = pending.get(reply.id);
    if (!request) return;
    pending.delete(reply.id);
    request.cleanup();
    if (reply.error) { request.reject(fail(reply.error)); return; }
    let bytes = decode(reply.body || "");
    let body;
    try {
      body = JSON.parse(new TextDecoder().decode(bytes));
    } catch { /* Non-JSON errors retain the normal response handling. */ }
    if (config.post.includes(request.path) && (reply.status === 401 ||
        (body?.status?.responseStatus === "Failure" &&
         /session.*expired|invalid.*token|token.*expired|login again/i.test(body.status.errors?.[0] ?? "")))) expire();
    if (request.path === "/token/refreshTokenRequest" &&
        (reply.status !== 200 || body?.response?.msg !== "Success")) expire();
    if (request.path === "/clxuser/getmenulist" && reply.status === 200 && Array.isArray(body?.response)) {
      body.response = pruneMenu(body.response);
      bytes = new TextEncoder().encode(JSON.stringify(body));
    }
    request.resolve(new Response([204, 205, 304].includes(reply.status) ? null : bytes, {
      status: reply.status, headers: reply.headers || {},
    }));
  };
  const request = (url, method, headers, body, signal) => new Promise((resolve, reject) => {
    const path = apiPath(url);
    const allowed = method === "POST" ? config.post : method === "GET" ? config.get : [];
    if (!path || !allowed.includes(path)) {
      notify("blocked");
      // Angular's interceptor expects the portal's normal HTTP error shape.
      // Returning a local 403 gives it an actionable toast without a request.
      resolve(new Response(JSON.stringify({ status: { responseStatus: "Failure", errors: ["Read-only view. Use the actual portal for this action."] } }),
        { status: 403, headers: { "content-type": "application/json" } }));
      return;
    }
    if (signal?.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
    const id = `${nonce}:${++sequence}`;
    const abort = () => {
      if (!pending.delete(id)) return;
      cleanup();
      bridge.postMessage(JSON.stringify({ cancel: id }));
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timeout = setTimeout(() => {
      if (!pending.delete(id)) return;
      cleanup();
      bridge.postMessage(JSON.stringify({ cancel: id }));
      reject(fail("The portal took too long to respond. Please retry."));
    }, 45_000);
    const cleanup = () => { clearTimeout(timeout); signal?.removeEventListener("abort", abort); };
    pending.set(id, { resolve, reject, cleanup, path });
    signal?.addEventListener("abort", abort, { once: true });
    try {
      bridge.postMessage(JSON.stringify({ id, path, method, headers, body: body || "" }));
    } catch (error) { pending.delete(id); cleanup(); reject(error); }
  });

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const req = new Request(input, init);
    if (!apiPath(req.url)) {
      const url = new URL(req.url);
      if (url.origin !== config.origin || !url.pathname.startsWith(config.pagePrefix)) {
        notify("blocked");
        throw fail("Only official portal reads are available here.");
      }
      return originalFetch(req);
    }
    return request(req.url, req.method, Object.fromEntries(req.headers),
      ["GET", "HEAD"].includes(req.method) ? "" : await req.text(), req.signal);
  };

  // WebView interception cannot obtain POST bodies. A small XHR adapter keeps
  // Angular's HttpClient/Zone.js event contract while carrying bodies via the
  // origin-scoped asynchronous native bridge. Never fall back to hosted /api.
  class PortalXHR extends EventTarget {
    constructor() {
      super();
      this.readyState = 0; this.status = 0; this.statusText = "";
      this.response = null; this.responseText = ""; this.responseURL = "";
      this.responseType = ""; this.timeout = 0; this.withCredentials = false;
      this.upload = new EventTarget(); this.headers = new Headers();
      this.responseHeaders = new Headers(); this.controller = null;
    }
    emit(type) {
      const event = new ProgressEvent(type);
      this.dispatchEvent(event);
      if (typeof this[`on${type}`] === "function") this[`on${type}`].call(this, event);
    }
    state(value) { this.readyState = value; this.emit("readystatechange"); }
    open(method, url, async = true) {
      if (!async) throw fail("Synchronous requests are unavailable.");
      this.abort(); this.method = String(method).toUpperCase();
      this.url = new URL(url, location.href).href; this.headers = new Headers();
      this.status = 0; this.response = null; this.responseText = "";
      this.responseHeaders = new Headers(); this.responseURL = ""; this.state(1);
    }
    setRequestHeader(name, value) { this.headers.append(name, value); }
    getResponseHeader(name) { return this.responseHeaders.get(name); }
    getAllResponseHeaders() { return Array.from(this.responseHeaders, ([k, v]) => `${k}: ${v}\r\n`).join(""); }
    overrideMimeType() {}
    abort() {
      if (!this.controller) return;
      const controller = this.controller; this.controller = null;
      controller.abort(); this.status = 0; this.state(4);
      this.emit("abort"); this.emit("loadend"); this.readyState = 0;
    }
    send(body = null) {
      if (this.readyState !== 1 || this.controller) throw new DOMException("Invalid state", "InvalidStateError");
      const controller = new AbortController(); this.controller = controller;
      const timer = this.timeout > 0 ? setTimeout(() => {
        if (this.controller !== controller) return;
        this.controller = null; controller.abort(); this.state(4);
        this.emit("timeout"); this.emit("loadend");
      }, this.timeout) : null;
      this.emit("loadstart");
      const options = { method: this.method, headers: this.headers, signal: controller.signal };
      if (!["GET", "HEAD"].includes(this.method) && body != null) options.body = body;
      window.fetch(this.url, options).then(async (response) => {
        if (this.controller !== controller) return;
        this.status = response.status; this.statusText = response.statusText;
        this.responseURL = this.url; this.responseHeaders = response.headers; this.state(2);
        const bytes = await response.arrayBuffer();
        if (this.controller !== controller) return;
        this.state(3);
        if (this.responseType === "arraybuffer") this.response = bytes;
        else if (this.responseType === "blob") this.response = new Blob([bytes], { type: response.headers.get("content-type") || "" });
        else {
          this.responseText = new TextDecoder().decode(bytes);
          if (this.responseType === "json") { try { this.response = JSON.parse(this.responseText); } catch { this.response = null; } }
          else this.response = this.responseText;
        }
        this.controller = null; this.state(4); this.emit("load"); this.emit("loadend");
      }).catch(() => {
        if (this.controller !== controller) return;
        this.controller = null; this.status = 0; this.state(4); this.emit("error"); this.emit("loadend");
      }).finally(() => { if (timer != null) clearTimeout(timer); });
    }
  }
  for (const [name, value] of Object.entries({ UNSENT: 0, OPENED: 1, HEADERS_RECEIVED: 2, LOADING: 3, DONE: 4 })) {
    PortalXHR[name] = PortalXHR.prototype[name] = value;
  }
  window.XMLHttpRequest = PortalXHR;
  navigator.sendBeacon = () => false;
  window.open = () => { notify("blocked"); return null; };
  // The original portal's Logout routes to its login screen. Close this
  // read-only view instead; the main Lazyportal account is independent.
  window.addEventListener("hashchange", () => {
    if (!location.hash.replace(/^#\/?/, "")) notify("close");
  });
  window.addEventListener("pagehide", () => {
    for (const [id, item] of pending) {
      item.cleanup(); item.reject(new DOMException("Closed", "AbortError"));
      bridge.postMessage(JSON.stringify({ cancel: id }));
    }
    pending.clear();
  });
})({"version":1,"origin":"https://official.lazyportal.invalid","upstream":"https://studentportal.juet.ac.in","pagePrefix":"/studentportal/","apiPrefix":"/StudentPortalAPI/","entry":"/studentportal/#/dashbord","assetAliases":{"https://fonts.gstatic.com/s/materialicons/v145/flUhRq6tzZclQEJ-Vdg-IuiaDsNcIhQ8tQ.woff2":"/studentportal/__material-icons.woff2"},"post":["/clxuser/getmenulist","/feedbackformcontroller/getCreadits","/feedbackformcontroller/getDataForFeedback","/onlinefeepayment/getmyactivefeeevents","/onlinefeepayment/loadmyfeedetail","/token/refreshTokenRequest","/StudentClassAttendance/getstudentInforegistrationforattendence","/StudentClassAttendance/getstudentattendancedetail","/StudentClassAttendance/getstudentsubjectpersentage","/StudentClassAttendance/getpreviousstudentsubjectpersentage","/studentcommonsontroller/getsemestercode-exammarks","/studentcommonsontroller/getsemestercode-withstudentexamevents","/studentcommonsontroller/getstudentexamevents","/studentsexamview/getstudent-exammarks","/studentsttattview/getstudent-examschedule","/studentgradecard/getregistrationList","/studentgradecard/getstudentinfo","/studentgradecard/showstudentgradecard","/studentsgpacgpa/loadData","/studentsgpacgpa/checkIfstudentmasterexist","/studentsgpacgpa/getallsemesterdata","/studentsgpacgpa/getallsemesterdatadetail","/reqsubfaculty/getregistrationList","/reqsubfaculty/getfaculties","/reqsubfaculty/getstudentprogrambranch","/reqsubfaculty/getstudents","/studentchoiceprint/getsemestercodelist","/studentchoiceprint/getsubjectpreference","/suppsubjectchoiceprint/getsemestercodelist","/suppsubjectchoiceprint/getsubjectpreference","/myhostelallocationdetail/gethostelallocationdetail","/studentpersinfo/getstudent-personalinformation","/studentinformation/getstudentmedicalinfo","/studentdisciplinarydetails/getstudentdisciplinarydetails","/studentbankdetails/getstudentbankinfo","/studentfeeledger/loadfeesummary","/studentfeeledger/loadfeeheadwisedetails","/studentfeeledger/fetchfeetransaction","/studentfeeledger/getfeewisedetaildata","/registrationslip/getStudentInfo","/registrationslip/getStudentRegistrationInfo","/moocsubjectstatus/getsemestercodelist","/moocsubjectstatus/getsubjectstatus","/adddropsubjectstatus/getsemestercodelist","/adddropsubjectstatus/getsubjectstatus","/servicerequestbystudent/getpendingservicerequestgrid","/servicerequestbystudent/getapprovedrequestgrid","/servicerequestbystudent/getclosedservicerequests","/servicerequestbystudent/getcancelledwalservicerequests","/servicerequestbystudent/getwithdwalservicerequests","/servicerequestbystudent/getfeepaidservicerequests"],"get":["/token/getlogoClientWise","/token/marqeelist","/token/productversion"],"routes":["dashbord","student/myclassattendance","student/myexaminationschedule","student/eventsubjectmarks","student/studentgradecard","student/studentresult","student/studentregisteredfaculty","student/studentsubjectchoiceprint","student/supplimentarysubjectchoiceprint","student/hostelallocationdetails","student/studentsPersonalInfo","student/medicalformforstudent","student/studentdisciplinarydetail","student/studentbankdetail","student/studentfeeledger","student/registrationslip","student/moocsubjectstatus","student/subjectadddropstatus","student/servicerequest"],"storage":{"Token":"instrumentation-token","Username":"INSTRUMENTATION","userid":"instrumentation-user","clientid":"","companyid":"","name":"","membertype":"S","enrollmentno":"","instituteid":"instrumentation-institute","institutename":"","usertypeselected":"S","tokendate":"Sat Oct 24 2026 11:30:00 GMT+0530 (India Standard Time)","Today_DATE":"1792821600000","bypassValue":""}});
