import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { getSessionStatus } from "../lib/portal";
import { shouldThrottleRefresh, recordRefreshAttempt } from "../components/DataViews";
import { TABS } from "../sections";
import { AttendancePage } from "./AttendancePage";
import { MorePage } from "./MorePage";
import { ReconnectModal } from "../components/ReconnectModal";
import { NavigationBar, type NavItem } from "../components/NavigationBar";
import { ShellContext, type Shell } from "../components/AppBar";
import { AttendanceIcon, MoreIcon } from "../components/icons";
import type { Session } from "../types";

const HOME = "attendance";
const tabFromHash = (ids: string[]) => {
  const h = typeof window !== "undefined" ? window.location.hash.slice(1) : "";
  return ids.includes(h) ? h : HOME;
};

export function DashboardPage({
  session,
  isExpired,
  isRecovering,
  onLogout,
  onSessionRenewed,
  onSelectInstitute,
}: {
  session: Session;
  isExpired?: boolean;
  isRecovering?: boolean;
  onLogout: () => void;
  onSessionRenewed?: (s: Session) => void;
  onSelectInstitute: (instituteid: string) => void;
}) {
  const [showRenewModal, setShowRenewModal] = useState(false);
  const [dashboardSpinning, setDashboardSpinning] = useState(false);
  const [shorts, setShorts] = useState(0);
  const spinTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Silent recovery takes priority over the manual form.
  useEffect(() => {
    if (isRecovering || !isExpired) setShowRenewModal(false);
  }, [isExpired, isRecovering]);
  useEffect(() => () => { if (spinTimer.current) clearTimeout(spinTimer.current); }, []);

  const refreshDashboard = useCallback(() => {
    setDashboardSpinning(true);
    if (spinTimer.current) clearTimeout(spinTimer.current);
    spinTimer.current = setTimeout(() => setDashboardSpinning(false), 600);
    if (shouldThrottleRefresh("dashboard") || navigator.onLine === false) return;
    window.dispatchEvent(new CustomEvent("juet:refresh-dashboard"));
    if (getSessionStatus() !== "expired") recordRefreshAttempt("dashboard");
  }, []);

  const shell = useMemo<Shell>(() => ({
    isExpired: Boolean(isExpired),
    isRecovering: Boolean(isRecovering),
    requestRenew: () => setShowRenewModal(true),
    refreshDashboard,
    dashboardSpinning,
    setShorts,
  }), [isExpired, isRecovering, refreshDashboard, dashboardSpinning]);

  const tabs = TABS.filter((t) => t.enabled !== false);
  const navItems: NavItem[] = [
    { id: HOME, label: "Attendance", Icon: AttendanceIcon, badge: shorts },
    ...tabs.map((t) => ({ id: t.id, label: t.label, Icon: t.Icon })),
    { id: "more", label: "More", Icon: MoreIcon },
  ];
  const ids = navItems.map((n) => n.id);

  const [tab, setTab] = useState(() => tabFromHash(ids));
  // Tabs mount on first visit and stay alive, so switching back is instant.
  const [visited, setVisited] = useState(() => new Set([HOME, tab]));
  const scrollByTab = useRef<Record<string, number>>({});

  useEffect(() => {
    const onHash = () => setTab(tabFromHash(ids));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join()]);

  useEffect(() => {
    setVisited((v) => (v.has(tab) ? v : new Set(v).add(tab)));
    window.scrollTo({ top: scrollByTab.current[tab] ?? 0, behavior: "instant" });
  }, [tab]);

  // Back always returns to Attendance (Android start-destination rule):
  // leaving home pushes one entry, hopping between other tabs replaces it.
  const select = (next: string) => {
    if (next === tab) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    scrollByTab.current[tab] = window.scrollY;
    if (next === HOME) {
      if (window.location.hash) history.back();
      else setTab(HOME);
    } else if (tab === HOME) {
      window.location.hash = next;
    } else {
      history.replaceState(null, "", `#${next}`);
      setTab(next);
    }
  };

  return (
    <ShellContext.Provider value={shell}>
      <main className="dash">
        <div className="tab-panel" hidden={tab !== HOME}>
          <AttendancePage session={session} isExpired={isExpired} isRecovering={isRecovering} onLogout={onLogout} />
        </div>
        {tabs.map(({ id, Component }) =>
          visited.has(id) ? (
            <div key={`${id}:${String(session.instituteid ?? "")}`} className="tab-panel" hidden={tab !== id}>
              <Component session={session} onLogout={onLogout} />
            </div>
          ) : null,
        )}
        {visited.has("more") && (
          <div className="tab-panel" hidden={tab !== "more"}>
            <MorePage session={session} onLogout={onLogout} onSelectInstitute={onSelectInstitute} />
          </div>
        )}
      </main>
      <NavigationBar items={navItems} active={tab} onSelect={select} />
      {showRenewModal && onSessionRenewed && (
        <ReconnectModal
          session={session}
          onRenewed={(s) => {
            setShowRenewModal(false);
            onSessionRenewed(s);
          }}
          onClose={() => setShowRenewModal(false)}
        />
      )}
    </ShellContext.Provider>
  );
}
