import type { Session } from "../types";
import { crypto as campusCrypto } from "@juet/core";
import { PROD_API_BASE } from "./apiBase";
import {
  OFFICIAL_PORTAL_BRIDGE_KEY,
  OFFICIAL_PORTAL_PREFIX,
  OFFICIAL_PORTAL_STORAGE_KEYS,
  buildOfficialPortalBridgePayload,
} from "../../../../shared/officialPortal.js";

export { OFFICIAL_PORTAL_BRIDGE_KEY };

const env = (import.meta as unknown as { env?: Record<string, string> }).env ?? {};

// ponytail: read the native bridge global directly — avoids bundling @capacitor/core in the web build
function isNativePlatform(): boolean {
  try {
    const cap = (
      globalThis as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }
    ).Capacitor;
    return typeof cap?.isNativePlatform === "function" ? cap.isNativePlatform() : false;
  } catch {
    return false;
  }
}

// The native shell serves the app from https://localhost, where same-origin
// /officialportal does not exist. Point the frame at the hosted proxy instead
// (same release-time constant as lib/apiBase.js: a moved deployment needs a
// new app build). The bootstrap's postMessage handoff carries the session
// across origins because localStorage is not shared with the iframe there.
function nativePortalBase(): string {
  const apiBase = (env.VITE_NATIVE_API_BASE || PROD_API_BASE).trim().replace(/\/+$/, "");
  return `${apiBase.replace(/\/api\/?$/, "")}${OFFICIAL_PORTAL_PREFIX}`;
}

export function getOfficialPortalUrl(version = 0) {
  const prefix = isNativePlatform() ? nativePortalBase() : OFFICIAL_PORTAL_PREFIX;
  return `${prefix}?v=${version}#/dashbord`;
}

export function writeOfficialPortalBridge(session: Session): Promise<void> {
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
  // Background upgrade: GetNavigation wants bypassValue as AES ciphertext,
  // not the raw session value. Same date-key scheme as core crypto (IST vs
  // device-local agree for IST users; may differ at the midnight boundary
  // elsewhere). Resolves when the stored bridge is final.
  return buildOfficialPortalBridgePayload(session, (plain) =>
    campusCrypto.encrypt(plain, { now: new Date() })
  )
    .then((upgraded) => {
      if (upgraded === raw) return;
      try {
        localStorage.setItem(OFFICIAL_PORTAL_BRIDGE_KEY, upgraded);
      } catch {
        // ignored
      }
      try {
        sessionStorage.setItem(OFFICIAL_PORTAL_BRIDGE_KEY, upgraded);
      } catch {
        // ignored
      }
    })
    .catch(() => {
      // raw bridge already written above
    });
}

export function readOfficialPortalBridge(): string {
  try {
    return localStorage.getItem(OFFICIAL_PORTAL_BRIDGE_KEY) || "";
  } catch {
    // ignored
  }
  try {
    return sessionStorage.getItem(OFFICIAL_PORTAL_BRIDGE_KEY) || "";
  } catch {
    return "";
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
