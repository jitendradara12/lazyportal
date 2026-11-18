import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { writePersistentValue } from "../hooks/usePersistentState";

export type AlertTab = "attendance" | "marks" | "exams" | "calendar" | "more";
export type AlertMode = "marks" | "cgpa";
export type AlertPermission = "granted" | "denied" | "prompt";

export interface AlertsStatus {
  supported: boolean;
  muted: boolean;
  enabled: boolean;
  permission: AlertPermission;
}

export interface NotificationAction {
  tab?: AlertTab;
  mode?: AlertMode;
  refresh?: boolean;
}

interface AlertsPluginApi {
  getStatus(): Promise<Partial<AlertsStatus>>;
  setMuted(options: { muted: boolean }): Promise<Partial<AlertsStatus>>;
  openSettings(): Promise<{ opened?: boolean }>;
  consumePendingAction(): Promise<{ action?: unknown }>;
  addListener(event: "notificationAction", callback: (data: unknown) => void): Promise<PluginListenerHandle>;
}

const alertsPlugin = registerPlugin<AlertsPluginApi>("Alerts");

const VALID_TABS = new Set<AlertTab>(["attendance", "marks", "exams", "calendar", "more"]);
const VALID_MODES = new Set<AlertMode>(["marks", "cgpa"]);
const PROMPT_DISMISSED_KEY = "juet.portal.alerts_prompt_dismissed";
const DEFAULT_STATUS: AlertsStatus = { supported: false, muted: false, enabled: false, permission: "prompt" };

let currentStatus: AlertsStatus = DEFAULT_STATUS;
let statusSeq = 0;
const statusListeners = new Set<(status: AlertsStatus) => void>();
const pendingTabRefreshes = new Set<string>();

function isAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("Alerts");
}

function normalizeStatus(raw: Partial<AlertsStatus> | null | undefined): AlertsStatus {
  if (!raw || raw.supported !== true) {
    return DEFAULT_STATUS;
  }
  const permission: AlertPermission =
    raw.permission === "granted" || raw.permission === "denied" || raw.permission === "prompt"
      ? raw.permission
      : "prompt";
  const muted = Boolean(raw.muted);
  return {
    supported: true,
    muted,
    enabled: !muted && permission === "granted",
    permission,
  };
}

function setCachedStatus(next: AlertsStatus): AlertsStatus {
  currentStatus = next;
  for (const listener of statusListeners) {
    try { listener(next); } catch {}
  }
  return next;
}

export function getCachedAlertsStatus(): AlertsStatus {
  return currentStatus;
}

export function subscribeAlertsStatus(listener: (status: AlertsStatus) => void): () => void {
  statusListeners.add(listener);
  return () => { statusListeners.delete(listener); };
}

export async function getAlertsStatus(): Promise<AlertsStatus> {
  if (!isAvailable()) return setCachedStatus(DEFAULT_STATUS);
  const seq = ++statusSeq;
  try {
    const next = normalizeStatus(await alertsPlugin.getStatus());
    return seq === statusSeq ? setCachedStatus(next) : currentStatus;
  } catch {
    return seq === statusSeq ? setCachedStatus(DEFAULT_STATUS) : currentStatus;
  }
}

export async function setAlertsMuted(muted: boolean): Promise<AlertsStatus> {
  if (!isAvailable()) return setCachedStatus(DEFAULT_STATUS);
  const seq = ++statusSeq;
  const raw = await alertsPlugin.setMuted({ muted });
  const next = normalizeStatus(raw);
  return seq === statusSeq ? setCachedStatus(next) : currentStatus;
}

export function setOptimisticAlertsStatus(next: AlertsStatus): void {
  statusSeq++;
  setCachedStatus(next);
}

export async function openAlertSettings(): Promise<boolean> {
  if (!isAvailable()) return false;
  try {
    const res = await alertsPlugin.openSettings();
    return Boolean(res?.opened ?? true);
  } catch {
    return false;
  }
}

export function parseNotificationAction(raw: unknown): NotificationAction | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const rawTab = typeof obj.tab === "string" ? obj.tab.trim() : "";
  const rawMode = typeof obj.mode === "string" ? obj.mode.trim() : "";
  const tab = VALID_TABS.has(rawTab as AlertTab) ? (rawTab as AlertTab) : undefined;
  const mode = VALID_MODES.has(rawMode as AlertMode) ? (rawMode as AlertMode) : undefined;
  const resolvedTab = tab ?? (mode ? "marks" : undefined);
  const refresh = obj.refresh === true || obj.refresh === "1" || obj.refresh === "true";
  if (!resolvedTab && !refresh) return null;
  return {
    ...(resolvedTab ? { tab: resolvedTab } : {}),
    ...(mode ? { mode } : {}),
    ...(refresh ? { refresh: true } : {}),
  };
}

export function parseNotificationSearch(search: string): NotificationAction | null {
  if (!search) return null;
  const params = new URLSearchParams(search);
  return parseNotificationAction({
    tab: params.get("tab"),
    mode: params.get("mode"),
    refresh: params.get("refresh"),
  });
}

export async function consumePendingNotificationAction(): Promise<NotificationAction | null> {
  if (!isAvailable()) return null;
  try {
    const res = await alertsPlugin.consumePendingAction();
    return parseNotificationAction(res?.action);
  } catch {
    return null;
  }
}

export function subscribeNotificationAction(cb: (action: NotificationAction) => void): () => void {
  if (!isAvailable()) return () => {};
  let active = true;
  let handle: PluginListenerHandle | undefined;
  void alertsPlugin.addListener("notificationAction", (data) => {
    if (!active) return;
    const action = parseNotificationAction(data);
    if (action) cb(action);
  }).then((h) => {
    if (!active) { void h.remove().catch(() => {}); return; }
    handle = h;
  }).catch(() => {});
  return () => {
    active = false;
    if (handle) void handle.remove().catch(() => {});
  };
}

function readResultsMode(): AlertMode {
  try {
    return globalThis.localStorage?.getItem("juet.portal.results.mode") === "cgpa" ? "cgpa" : "marks";
  } catch {
    return "marks";
  }
}

export function resolveTabRefreshKey(tab?: AlertTab, mode?: AlertMode): string | undefined {
  if (tab === "marks") return mode ?? readResultsMode();
  if (!tab && mode) return mode;
  return tab;
}

export function requestTabRefresh(tab?: AlertTab, mode?: AlertMode): void {
  if (mode === "marks" || mode === "cgpa") {
    writePersistentValue("results.mode", mode);
  }
  const key = resolveTabRefreshKey(tab, mode);
  if (!key) return;
  pendingTabRefreshes.add(key);
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new CustomEvent("juet:refresh-tab", { detail: { key, tab, mode } }));
  }
}

export function consumePendingTabRefresh(key: string): boolean {
  return pendingTabRefreshes.delete(key);
}

export function onTabRefresh(key: string, cb: () => void): () => void {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return () => {};
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ key?: string }>).detail;
    if (detail?.key !== key) return;
    pendingTabRefreshes.delete(key);
    cb();
  };
  window.addEventListener("juet:refresh-tab", handler);
  return () => window.removeEventListener("juet:refresh-tab", handler);
}

export function isAlertsPromptDismissed(): boolean {
  try {
    return globalThis.localStorage?.getItem(PROMPT_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissAlertsPrompt(): void {
  try {
    globalThis.localStorage?.setItem(PROMPT_DISMISSED_KEY, "1");
  } catch {}
}
