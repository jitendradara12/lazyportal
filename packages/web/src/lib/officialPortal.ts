import { Capacitor, registerPlugin } from "@capacitor/core";
import { officialPortal, session as portalSession } from "@juet/core";
import { getSessionStatus, setSessionStatus, store } from "./portal";
import type { Session } from "../types";

const nativePortal = registerPlugin<{
  open(options: { version: number; bootstrap: string }): Promise<{ expired?: boolean }>;
  clear(): Promise<void>;
}>("OfficialPortal");

export const hasOfficialPortal = () => Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("OfficialPortal");
let generation = 0;

/** No fetch, refresh, iframe, hosted fallback, or persistent bridge payload. */
export async function openOfficialPortal(fallback: Session) {
  if (!hasOfficialPortal()) throw new Error("The official portal view is available in the Android app.");
  if (getSessionStatus() !== "authenticated") throw new Error("Reconnect to your account before opening the official portal.");
  const current = ++generation;
  const prepared = await officialPortal.prepareOfficialPortal(store.load() ?? fallback);
  if (current !== generation) return;
  const result = await nativePortal.open(prepared);
  if (current !== generation) return;
  if (result?.expired) {
    portalSession.markSessionExpired();
    setSessionStatus("expired");
  }
}

/** Also invalidates preparations still awaiting encryption during logout. */
export function clearOfficialPortal() {
  generation++;
  if (hasOfficialPortal()) void nativePortal.clear().catch(() => {});
}
