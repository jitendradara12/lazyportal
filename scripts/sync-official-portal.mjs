// Keep protocol constants in core; Android consumes a generated, APK-pinned
// policy. Checked in so Android Studio builds also work before cap:sync.
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { officialPortalPolicy, prepareOfficialPortal } from "../packages/core/src/officialPortal.js";
import { portalApiPolicy } from "../packages/core/src/portalTransport.js";

await copyFile(new URL("../shared/portal-intermediate.pem", import.meta.url),
  new URL("../android/app/src/main/assets/official-portal-intermediate.pem", import.meta.url));

await writeFile(new URL("../android/app/src/main/assets/official-portal-policy.json", import.meta.url),
  JSON.stringify(officialPortalPolicy, null, 2) + "\n");
await writeFile(new URL("../android/app/src/main/assets/portal-api-policy.json", import.meta.url),
  JSON.stringify(portalApiPolicy, null, 2) + "\n");

// Instrumentation exercises the actual serialized runtime, not a hand-written
// bridge stub. Fake identity only; this asset belongs to the test APK.
const fixture = await prepareOfficialPortal({ token: "instrumentation-token", userid: "instrumentation-user",
  instituteid: "instrumentation-institute", username: "INSTRUMENTATION" },
{ now: new Date("2026-10-24T06:00:00Z") });
await mkdir(new URL("../android/app/src/androidTest/assets/", import.meta.url), { recursive: true });
await writeFile(new URL("../android/app/src/androidTest/assets/official-portal-bootstrap.js", import.meta.url), fixture.bootstrap + "\n");
