import { Capacitor, registerPlugin } from "@capacitor/core";
import { officialPortal, session } from "@juet/core";
import { client, getSessionStatus, store } from "./portal";

const nativePortal = registerPlugin<{
  open(options: { version: number; bootstrap: string }): Promise<{ expired?: boolean }>;
  clear(): Promise<void>;
}>("OfficialPortal");

export const hasOfficialPortal = () => Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("OfficialPortal");
let generation = 0;

/** Recover before handoff when possible; retry a native expiry once. */
export async function openOfficialPortal() {
  if (!hasOfficialPortal()) throw new Error("The official portal view is available in the Android app.");
  const current = ++generation;
  const reconnect = () => new Error("Reconnect to your account before opening the official portal.");
  const live = store.load();
  if (!live?.token || getSessionStatus() === "expired") throw reconnect();
  if (getSessionStatus() === "recovering" || session.isExpired(live.token)) {
    const recovered = await client.recoverSession(live.token);
    if (current !== generation) return;
    if (!recovered) throw reconnect();
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const handedOff = store.load();
    if (!handedOff?.token) throw reconnect();
    const prepared = await officialPortal.prepareOfficialPortal(handedOff);
    if (current !== generation) return;
    if (getSessionStatus() !== "authenticated" || store.load()?.token !== handedOff.token) {
      throw new Error("Your session changed. Please retry opening the portal.");
    }
    const result = await nativePortal.open(prepared);
    if (current !== generation || !result?.expired) return;
    if (attempt === 1) throw new Error("The portal rejected the renewed session. Please retry.");
    const recovered = await client.recoverSession(handedOff.token);
    if (current !== generation) return;
    if (!recovered) throw reconnect();
  }
}

/** Also invalidates preparations still awaiting encryption during logout. */
export function clearOfficialPortal() {
  generation++;
  if (hasOfficialPortal()) void nativePortal.clear().catch(() => {});
}
