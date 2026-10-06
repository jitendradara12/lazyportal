import test from "node:test";
import assert from "node:assert/strict";

const { preserveSelectedInstitute } = await import("../src/lib/sessionSelection.ts");

test("a fresh login retains the currently selected institute", () => {
  const fresh = {
    token: "new-token",
    instituteid: "campus-one",
    institutename: "Campus One",
    institutelist: [
      { value: "campus-one", label: "Campus One" },
      { value: "campus-two", label: "Campus Two" },
    ],
  };
  const current = {
    token: "old-token",
    instituteid: "campus-two",
    institutename: "Campus Two",
    institutelist: fresh.institutelist,
  };

  assert.deepEqual(preserveSelectedInstitute(fresh, current), {
    ...fresh,
    instituteid: "campus-two",
    institutename: "Campus Two",
  });
});

test("a current institute name is a fallback when its label is missing", () => {
  const fresh = { token: "new-token", instituteid: "campus-one", institutename: "Campus One" };
  const current = { instituteid: "campus-two", institutename: "Saved Campus Name" };

  assert.deepEqual(preserveSelectedInstitute(fresh, current), {
    ...fresh,
    instituteid: "campus-two",
    institutename: "Saved Campus Name",
  });
});

test("use the newly logged-in default when no institute had previously been selected", () => {
  const fresh = { token: "new-token", instituteid: "campus-one", institutename: "Campus One" };

  assert.equal(preserveSelectedInstitute(fresh, { instituteid: null }), fresh);
});
