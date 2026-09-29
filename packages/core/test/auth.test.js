import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { login, fetchCaptcha } from "../src/auth.js";

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
    assert.equal(cap.imageDataUrl, "data:image/jpeg;base64,img");
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

  it("refreshSession posts username+tokendate and sniffs rotated tokens", async () => {
    let seen;
    let skip;
    const fakeClient = {
      async postRaw(endpoint, payload, opts) {
        seen = [endpoint, payload];
        skip = opts?.skipRefresh;
        return { response: { msg: "Success", token: "T2" } };
      },
    };
    const { refreshSession } = await import("../src/auth.js");
    const out = await refreshSession(fakeClient, { username: "u", tokendate: "d" });
    assert.deepEqual(seen, ["/token/refreshTokenRequest", { username: "u", tokendate: "d" }]);
    assert.equal(skip, true);
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
});
