import { useState, useEffect, useRef, useMemo } from "react";
import { TABS } from "../sections";
import { AttendancePage } from "./AttendancePage";
import { MorePage } from "./MorePage";
import { ReconnectModal } from "../components/ReconnectModal";
import { NavigationBar, type NavItem } from "../components/NavigationBar";
import { ShellContext, type Shell } from "../components/AppBar";
import { AttendanceIcon, MoreIcon } from "../components/icons";
import type { Session } from "../types";
import { BackScope, useAppBack } from "../hooks/useAppBack";
import { selectionHaptic } from "../lib/nativeInteractions";

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
  const [shorts, setShorts] = useState(0);

  // Silent recovery takes priority over the manual form.
  useEffect(() => {
    if (isRecovering || !isExpired) setShowRenewModal(false);
  }, [isExpired, isRecovering]);
  const shell = useMemo<Shell>(() => ({
    isExpired: Boolean(isExpired),
    isRecovering: Boolean(isRecovering),
    requestRenew: () => setShowRenewModal(true),
    setShorts,
  }), [isExpired, isRecovering]);

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
    selectionHaptic();
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

  useAppBack(tab !== HOME, () => {
    // A direct link may have no in-app history entry. Replace rather than leaving the app.
    history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    setTab(HOME);
    window.scrollTo({ top: scrollByTab.current[HOME] ?? 0, behavior: "instant" });
  }, 0);

  return (
    <ShellContext.Provider value={shell}>
      <div className="dashboard-shell">
        <main className="dash">
          <div className="tab-panel" hidden={tab !== HOME}>
            <BackScope.Provider value={tab === HOME}>
              <AttendancePage session={session} isExpired={isExpired} isRecovering={isRecovering} onLogout={onLogout} />
            </BackScope.Provider>
          </div>
          {tabs.map(({ id, Component }) =>
            visited.has(id) ? (
              <div key={`${id}:${String(session.instituteid ?? "")}`} className="tab-panel" hidden={tab !== id}>
                <BackScope.Provider value={tab === id}>
                  <Component session={session} onLogout={onLogout} />
                </BackScope.Provider>
              </div>
            ) : null,
          )}
          {visited.has("more") && (
            <div className="tab-panel" hidden={tab !== "more"}>
              <BackScope.Provider value={tab === "more"}>
                <MorePage session={session} onLogout={onLogout} onSelectInstitute={onSelectInstitute} />
              </BackScope.Provider>
            </div>
          )}
        </main>
        <NavigationBar items={navItems} active={tab} onSelect={select} />
      </div>
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
