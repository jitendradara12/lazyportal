import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateValue, encrypt, decrypt, makeLocalName } from "../src/crypto.js";

describe("crypto", () => {
  it("derives known key for 2026-09-28 (IST, Monday)", () => {
    // Verified against live portal Date header + local repro.
    const d = new Date(2026, 8, 28, 12, 0, 0); // local tz-agnostic fields
    assert.equal(d.getDate(), 28);
    assert.equal(generateValue(d), "qa8y2021896ty1pn");
  });

  it("roundtrips encrypt/decrypt", async () => {
    const now = new Date(2026, 8, 28);
    const cipher = await encrypt('{"username":"221B001"}', { now });
    assert.equal(await decrypt(cipher, { now }), '{"username":"221B001"}');
  });

  it("makeLocalName plain is 16 chars, encrypted decrypts back", async () => {
    const now = new Date(2026, 8, 28);
    const { plain, encrypted } = await makeLocalName({ now, random: () => 0.5 });
    assert.equal(plain.length, 16);
    assert.equal(await decrypt(encrypted, { now }), plain);
  });
});
