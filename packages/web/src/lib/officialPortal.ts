import type { Session } from "../types";
import {
  OFFICIAL_PORTAL_BRIDGE_KEY,
  OFFICIAL_PORTAL_PREFIX,
  OFFICIAL_PORTAL_STORAGE_KEYS,
} from "../../../../shared/officialPortal.js";

export { OFFICIAL_PORTAL_BRIDGE_KEY };

export function getOfficialPortalUrl(version = 0) {
  return `${OFFICIAL_PORTAL_PREFIX}/?v=${version}#/`;
}

export function writeOfficialPortalBridge(session: Session) {
  const raw = JSON.stringify(session);
  try {
    localStorage.setItem(OFFICIAL_PORTAL_BRIDGE_KEY, raw);
  } catch {
    // ignored
  }
  try {
    sessionStorage.setItem(OFFICIAL_PORTAL_BRIDGE_KEY, raw);
  } catch {
    // ignored
  }
}

export function clearOfficialPortalBridge() {
  for (const storage of [globalThis.localStorage, globalThis.sessionStorage]) {
    try {
      storage?.removeItem(OFFICIAL_PORTAL_BRIDGE_KEY);
      for (const key of OFFICIAL_PORTAL_STORAGE_KEYS) storage?.removeItem(key);
    } catch {
      // ignored
    }
  }
}
