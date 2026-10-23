// Keep protocol constants in core; Android consumes a generated, APK-pinned
// policy. Checked in so Android Studio builds also work before cap:sync.
import { writeFile } from "node:fs/promises";
import { officialPortalPolicy } from "../packages/core/src/officialPortal.js";

await writeFile(new URL("../android/app/src/main/assets/official-portal-policy.json", import.meta.url),
  JSON.stringify(officialPortalPolicy, null, 2) + "\n");
