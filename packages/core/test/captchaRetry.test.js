import { test } from "node:test";
import assert from "node:assert/strict";
import { loginWithCaptchaRetry } from "../src/auth.js";
import { CaptchaError, PortalError } from "../src/errors.js";

const params = { username: "test", password: "fixture", captcha: { hidden: "first", image: "fixture" }, captchaText: "wrong" };
function clientFixture({ reject = 1, generateError } = {}) {
  const submitted = [], fetched = [];
  return {
    submitted, fetched,
    async getPublic() {
      const hidden = `fresh-${fetched.length}`;
      fetched.push(hidden);
      return { response: { captcha: { hidden, image: "fixture" } } };
    },
    async post(path, payload) {
      if (path === "/token/pretoken-check") {
        submitted.push(payload.captcha);
        if (submitted.length <= reject) throw new CaptchaError();
        return { response: { random: "fixture", otppwd: "fixture" } };
      }
      if (generateError) throw generateError;
      return { response: { regdata: { token: "renewed" } } };
    },
  };
}

test("an automatic rejection retries with a matching fresh image, hidden token and answer", async () => {
  const client = clientFixture();
  const updates = [];
  const result = await loginWithCaptchaRetry(client, params, {
    maxAttempts: 3, solve: async () => "abcde", onCaptcha: (value) => updates.push(value),
  });
  assert.equal(result.token, "renewed");
  assert.deepEqual(client.submitted.map(c => [c.hidden, c.captcha]), [["first", "wrong"], ["fresh-0", "abcde"]]);
  assert.equal(updates[0].attempt, 2);
});

test("manual answers get one attempt and keep control of the image", async () => {
  const client = clientFixture();
  await assert.rejects(loginWithCaptchaRetry(client, params), CaptchaError);
  assert.equal(client.submitted.length, 1);
  assert.equal(client.fetched.length, 0);
});

test("automatic attempts are bounded, including unreadable images and decoder failures", async () => {
  for (const solve of [async () => "", async () => { throw new Error("Decode failed"); }]) {
    const client = clientFixture({ reject: Infinity });
    await assert.rejects(loginWithCaptchaRetry(client, params, { maxAttempts: 3, solve }), CaptchaError);
    assert.equal(client.fetched.length, 2);
    assert.equal(client.submitted.length, 1);
  }
});

test("credential and network errors stop automatic attempts immediately", async () => {
  for (const error of [new PortalError("Wrong password"), new PortalError("Offline", { code: "NETWORK_ERROR" })]) {
    const client = clientFixture({ reject: 0, generateError: error });
    await assert.rejects(loginWithCaptchaRetry(client, params, { maxAttempts: 8 }), e => e === error);
    assert.equal(client.submitted.length, 1);
    assert.equal(client.fetched.length, 0);
  }
});

test("cancellation prevents a fresh guess from being submitted", async () => {
  const client = clientFixture();
  const controller = new AbortController();
  await assert.rejects(loginWithCaptchaRetry(client, params, {
    maxAttempts: 3, signal: controller.signal, solve: async () => "abcde",
    onCaptcha: () => controller.abort(),
  }), { name: "AbortError" });
  assert.equal(client.submitted.length, 1);
});
