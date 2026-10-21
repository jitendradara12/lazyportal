import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { login, loginWithPassword, fetchCaptcha } from "../src/auth.js";

const NOW = new Date(2026, 8, 28);
const ok = (obj) => ({ ok: true, status: 200, text: async () => JSON.stringify(obj) });

describe("auth", () => {
  it("orchestrates pretoken -> gentoken without exposing random", async () => {
    const calls = [];
    const fakeClient = {
      async getPublic(endpoint) {
        calls.push(endpoint);
        return { response: { captcha: { hidden: "h", image: "img" } } };
      },
      async post(endpoint, payload) {
        calls.push([endpoint, payload]);
        if (endpoint === "/token/pretoken-check") {
          assert.equal(payload.username, "221B001");
          return { response: { random: "R1", otppwd: "PWD" } };
        }
        assert.equal(payload.random, "R1");
        assert.equal(payload.Modulename, "STUDENTMODULE");
        return {
          response: {
            regdata: {
              token: "T",
              clientid: "c",
              userid: "u",
              name: "n",
              membertype: "S",
              enrollmentno: "221B001",
              institutelist: [{ value: "i1", label: "JUET" }],
              bypass: "b",
            },
          },
        };
      },
    };
    const cap = await fetchCaptcha(fakeClient);
    assert.equal(cap.imageDataUrl, "data:image/png;base64,img");
    const session = await login(fakeClient, {
      username: "221B001",
      password: "secret",
      captchaText: "abcd",
      captcha: { hidden: "h", image: "img" },
    });
    assert.equal(session.token, "T");
    assert.equal(session.instituteid, "i1");
  });

  it("prefixes Parent usernames with P", async () => {
    let seen;
    const fakeClient = {
      async post(endpoint, payload) {
        if (endpoint === "/token/pretoken-check") {
          seen = payload.username;
          return { response: { random: "R1", otppwd: "PWD" } };
        }
        return {
          response: {
            regdata: { token: "T", institutelist: [{ value: "i1", label: "L" }] },
          },
        };
      },
    };
    await login(fakeClient, {
      username: "123",
      password: "p",
      captchaText: "c",
      captcha: { hidden: "h", image: "i" },
      usertype: "P",
    });
    assert.equal(seen, "P123");
  });

  it("uppercases enrollment numbers before pretoken", async () => {
    let seen;
    const fakeClient = {
      async post(endpoint, payload) {
        if (endpoint === "/token/pretoken-check") {
          seen = payload.username;
          return { response: { random: "R1", otppwd: "PWD" } };
        }
        return {
          response: {
            regdata: { token: "T", institutelist: [{ value: "i1", label: "L" }] },
          },
        };
      },
    };
    const session = await login(fakeClient, {
      username: "241b118",
      password: "p",
      captchaText: "c",
      captcha: { hidden: "h", image: "i" },
    });
    assert.equal(seen, "241B118");
    assert.equal(session.username, "241B118");
  });

  it("refreshSession posts username+tokendate and forwards cancellation", async () => {
    let seen;
    let options;
    const fakeClient = {
      async postRaw(endpoint, payload, opts) {
        seen = [endpoint, payload];
        options = opts;
        return { response: { msg: "Success", token: "T2" } };
      },
    };
    const { refreshSession } = await import("../src/auth.js");
    const controller = new AbortController();
    const out = await refreshSession(fakeClient, { username: "u", tokendate: "d" }, { signal: controller.signal });
    assert.deepEqual(seen, ["/token/refreshTokenRequest", { username: "u", tokendate: "d" }]);
    assert.equal(options?.skipRefresh, true);
    assert.equal(options?.signal, controller.signal);
    assert.deepEqual(out, { ok: true, token: "T2" });
  });

  it("refreshSession reports failure without success msg", async () => {
    const fakeClient = {
      async postRaw() {
        return { response: { msg: "Expired" } };
      },
    };
    const { refreshSession } = await import("../src/auth.js");
    assert.deepEqual(await refreshSession(fakeClient, {}), { ok: false });
  });

  it("login skips global 401 refresh (is the refresh itself)", async () => {
    const seenOpts = [];
    const fakeClient = {
      async post(endpoint, payload, opts) {
        seenOpts.push([endpoint, opts]);
        if (endpoint === "/token/pretoken-check") {
          return { response: { random: "R1", otppwd: "PWD" } };
        }
        return {
          response: {
            regdata: { token: "T", institutelist: [{ value: "i1", label: "L" }] },
          },
        };
      },
    };
    const controller = new AbortController();
    await login(fakeClient, {
      username: "221B001",
      password: "p",
      captchaText: "c",
      captcha: { hidden: "h", image: "i" },
    }, { signal: controller.signal });
    assert.equal(seenOpts.length, 2);
    for (const [, opts] of seenOpts) {
      assert.equal(opts?.skipRefresh, true);
      assert.equal(opts?.silent, true);
      assert.equal(opts?.signal, controller.signal);
    }
  });

  it("login preserves portal original tokendate across field variants", async () => {
    const variants = [
      { field: "tokendate", value: "2026-10-21 10:00:00" },
      { field: "TokenDate", value: "2026-10-21 11:00:00" },
      { field: "tokenDate", value: "2026-10-21 12:00:00" },
      { field: "token_date", value: "2026-10-21 13:00:00" },
      { field: "issuedate", value: "2026-10-21 14:00:00" },
      { field: "issuedAt", value: "2026-10-21 15:00:00" },
    ];

    for (const { field, value } of variants) {
      const fakeClient = {
        async post(endpoint) {
          if (endpoint === "/token/pretoken-check") {
            return { response: { random: "R1", otppwd: "PWD" } };
          }
          return {
            response: {
              regdata: {
                token: "T",
                institutelist: [{ value: "i1", label: "L" }],
                [field]: value,
              },
            },
          };
        },
      };
      const session = await login(fakeClient, {
        username: "221B001",
        password: "p",
        captchaText: "c",
        captcha: { hidden: "h", image: "i" },
      });
      assert.equal(session.tokendate, value, `Failed for field variant ${field}`);
    }
  });

  it("login preserves numeric timestamp tokendate as a string", async () => {
    const fakeClient = {
      async post(endpoint) {
        if (endpoint === "/token/pretoken-check") {
          return { response: { random: "R1", otppwd: "PWD" } };
        }
        return {
          response: {
            regdata: {
              token: "T",
              institutelist: [{ value: "i1", label: "L" }],
              tokendate: 1729531200000,
            },
          },
        };
      },
    };
    const session = await login(fakeClient, {
      username: "221B001",
      password: "p",
      captchaText: "c",
      captcha: { hidden: "h", image: "i" },
    });
    assert.equal(session.tokendate, "1729531200000");
  });

  it("login ignores whitespace-only variant and picks next valid variant or fallback", async () => {
    const fakeClient = {
      async post(endpoint) {
        if (endpoint === "/token/pretoken-check") {
          return { response: { random: "R1", otppwd: "PWD" } };
        }
        return {
          response: {
            regdata: {
              token: "T",
              institutelist: [{ value: "i1", label: "L" }],
              tokendate: "   ",
              issuedate: "2026-10-21 18:00:00",
            },
          },
        };
      },
    };
    const session = await login(fakeClient, {
      username: "221B001",
      password: "p",
      captchaText: "c",
      captcha: { hidden: "h", image: "i" },
    });
    assert.equal(session.tokendate, "2026-10-21 18:00:00");
  });

  it("loginWithPassword is exported as an alias of login", async () => {
    assert.equal(loginWithPassword, login);
    const fakeClient = {
      async post(endpoint) {
        if (endpoint === "/token/pretoken-check") {
          return { response: { random: "R1", otppwd: "PWD" } };
        }
        return {
          response: {
            regdata: {
              token: "T",
              institutelist: [{ value: "i1", label: "L" }],
              tokendate: "2026-10-21 19:00:00",
            },
          },
        };
      },
    };
    const session = await loginWithPassword(fakeClient, {
      username: "221B001",
      password: "p",
      captchaText: "c",
      captcha: { hidden: "h", image: "i" },
    });
    assert.equal(session.tokendate, "2026-10-21 19:00:00");
  });

  it("login falls back to fresh Date string when regdata does not provide tokendate", async () => {
    const fakeClient = {
      async post(endpoint) {
        if (endpoint === "/token/pretoken-check") {
          return { response: { random: "R1", otppwd: "PWD" } };
        }
        return {
          response: {
            regdata: {
              token: "T",
              institutelist: [{ value: "i1", label: "L" }],
            },
          },
        };
      },
    };
    const before = Date.now();
    const session = await login(fakeClient, {
      username: "221B001",
      password: "p",
      captchaText: "c",
      captcha: { hidden: "h", image: "i" },
    });
    const after = Date.now();
    assert.equal(typeof session.tokendate, "string");
    const parsed = Date.parse(session.tokendate);
    assert.ok(!Number.isNaN(parsed));
    assert.ok(parsed >= before - 1000 && parsed <= after + 1000);
  });
});

