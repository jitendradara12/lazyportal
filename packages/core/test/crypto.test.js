import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  generateValue,
  encrypt,
  decrypt,
  makeLocalName,
  importKey,
  _resetCryptoCacheForTesting,
} from "../src/crypto.js";

describe("crypto", () => {
  beforeEach(() => {
    _resetCryptoCacheForTesting();
  });
  it("derives known key for 2026-09-28 (IST, Monday)", () => {
    // Verified against live portal Date header + local repro.
    // 2026-09-28 12:00:00 IST = 2026-09-28 06:30:00 UTC
    const d = new Date(Date.UTC(2026, 8, 28, 6, 30, 0));
    assert.equal(generateValue(d), "qa8y2021896ty1pn");
  });

  it("roundtrips encrypt/decrypt", async () => {
    const now = new Date(Date.UTC(2026, 8, 28, 6, 30, 0));
    const cipher = await encrypt('{"username":"221B001"}', { now });
    assert.equal(await decrypt(cipher, { now }), '{"username":"221B001"}');
  });

  it("makeLocalName plain is 16 chars, encrypted decrypts back", async () => {
    const now = new Date(Date.UTC(2026, 8, 28, 6, 30, 0));
    const { plain, encrypted } = await makeLocalName({ now, random: () => 0.5 });
    assert.equal(plain.length, 16);
    assert.equal(await decrypt(encrypted, { now }), plain);
  });

  it("coalesces concurrent importKey calls to the exact same CryptoKey instance", async () => {
    const now = new Date(Date.UTC(2026, 8, 28, 6, 30, 0));
    const [k1, k2, k3] = await Promise.all([
      importKey(now),
      importKey(now),
      importKey(now),
    ]);
    assert.strictEqual(k1, k2);
    assert.strictEqual(k2, k3);
  });

  it("invalidates and updates the cached key across IST midnight day-swap", async () => {
    // 2026-09-28 23:59:59 IST = 2026-09-28 18:29:59 UTC
    const beforeMidnight = new Date(Date.UTC(2026, 8, 28, 18, 29, 59));
    // 2026-09-29 00:00:01 IST = 2026-09-28 18:30:01 UTC
    const afterMidnight = new Date(Date.UTC(2026, 8, 28, 18, 30, 1));

    const keyBefore = await importKey(beforeMidnight);
    const keyAfter = await importKey(afterMidnight);

    assert.notStrictEqual(keyBefore, keyAfter, "key must update across IST midnight");
    assert.notEqual(generateValue(beforeMidnight), generateValue(afterMidnight));

    const plain = "secret-session-token";
    const cipherDay1 = await encrypt(plain, { now: beforeMidnight });
    const cipherDay2 = await encrypt(plain, { now: afterMidnight });

    assert.notEqual(cipherDay1, cipherDay2, "different days must produce different ciphertexts");
    assert.equal(await decrypt(cipherDay1, { now: beforeMidnight }), plain);
    assert.equal(await decrypt(cipherDay2, { now: afterMidnight }), plain);

    // Cross-day decryption must fail because keys differ
    await assert.rejects(async () => {
      await decrypt(cipherDay1, { now: afterMidnight });
    });
  });

  it("handles concurrent operations across day boundaries cleanly", async () => {
    const day1 = new Date(Date.UTC(2026, 8, 28, 12, 0, 0));
    const day2 = new Date(Date.UTC(2026, 8, 29, 12, 0, 0));

    const [c1, c2, c3, c4] = await Promise.all([
      encrypt("msg1", { now: day1 }),
      encrypt("msg2", { now: day2 }),
      encrypt("msg3", { now: day1 }),
      encrypt("msg4", { now: day2 }),
    ]);

    const [p1, p2, p3, p4] = await Promise.all([
      decrypt(c1, { now: day1 }),
      decrypt(c2, { now: day2 }),
      decrypt(c3, { now: day1 }),
      decrypt(c4, { now: day2 }),
    ]);

    assert.equal(p1, "msg1");
    assert.equal(p2, "msg2");
    assert.equal(p3, "msg3");
    assert.equal(p4, "msg4");
  });
});
