import { Capacitor } from "@capacitor/core";
import { usePageRefresh } from "../hooks/usePageRefresh";
import { ATTENDANCE_TARGETS, useDefaultAttendanceTarget } from "../hooks/useDefaultAttendanceTarget";
import { SECTIONS } from "../sections";
import { TopBar } from "../components/AppBar";
import { titleCase } from "../components/DataViews";
import { GitHubIcon } from "../components/icons";
import { OfficialPortalEntry } from "../components/OfficialPortalEntry";
import { selectionHaptic } from "../lib/nativeInteractions";
import { AppUpdateAction } from "../components/AppUpdateAction";
import type { Session } from "../types";

interface InstituteOption {
  value?: string;
  label?: string;
}

export function MorePage({
  session,
  onLogout,
  onSelectInstitute,
  discreet,
  onDiscreetChange,
}: {
  session: Session;
  onLogout: () => void;
  onSelectInstitute: (instituteid: string) => void;
  discreet: boolean;
  onDiscreetChange: (value: boolean) => void;
}) {
  const institutes = (session.institutelist as InstituteOption[] | undefined) ?? [];
  const name = discreet ? "Student" : titleCase(session.name ?? session.enrollmentno ?? "Student");
  const initial = name.trim().charAt(0) || "S";

  const pageRefresh = usePageRefresh("more", session, false);
  const [defaultTarget, setDefaultTarget] = useDefaultAttendanceTarget();

  return (
    <div className="page">
      <TopBar title="More" {...pageRefresh} />
      <div className="page-body">
        <section className="profile">
          <span className="profile-avatar" aria-hidden="true">{initial}</span>
          <div className="profile-text">
            <h2 className="profile-name">{name}</h2>
            {discreet ? <span className="profile-sub">Identity hidden</span> :
              session.enrollmentno && <span className="profile-sub">{session.enrollmentno}</span>}
            {institutes.length > 1 ? (
              <select
                value={String(session.instituteid ?? "")}
                onChange={(e) => onSelectInstitute(e.target.value)}
                className="sem-picker profile-institute"
                aria-label="Select institute"
              >
                {institutes.map((o) => (
                  <option key={String(o.value)} value={String(o.value)}>{String(o.label ?? o.value)}</option>
                ))}
              </select>
            ) : session.institutename ? (
              <span className="profile-sub">{titleCase(session.institutename)}</span>
            ) : null}
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={discreet}
            aria-label="Discreet mode"
            aria-description="Hide your name, enrollment number and performance colors. Numbers stay visible."
            title="Hide your identity and performance colors. Numbers stay visible."
            className="discreet-switch"
            onClick={() => {
              selectionHaptic();
              onDiscreetChange(!discreet);
            }}
          >
            <span className="discreet-switch-track" aria-hidden="true">
              <span className="discreet-switch-thumb">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m5 12 4 4L19 6" />
                </svg>
              </span>
            </span>
            <span className="discreet-switch-label" aria-hidden="true">Discreet</span>
          </button>
        </section>

        <OfficialPortalEntry session={session} />

        <div className="m3-stacked-sections" role="list">
          {SECTIONS.filter((s) => s.enabled !== false).map(({ id, Component }) => (
            <Component key={`${id}:${String(session.instituteid ?? "")}`} session={session} onLogout={onLogout} />
          ))}
        </div>

        <section className="more-preference" aria-labelledby="default-attendance-target">
          <div className="more-preference-head">
            <span className="m3-leading-icon-circle more-preference-icon" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <circle cx="12" cy="12" r="6" />
                <circle cx="12" cy="12" r="2" />
              </svg>
            </span>
            <div className="more-preference-copy">
              <h2 id="default-attendance-target">Default attendance target</h2>
              <p>Starting target for the attendance calculator</p>
            </div>
          </div>
          <div className="segmented-pill-toggle" role="radiogroup" aria-labelledby="default-attendance-target">
            {ATTENDANCE_TARGETS.map((target) => (
              <button
                key={target}
                type="button"
                role="radio"
                aria-checked={defaultTarget === target}
                className={`segmented-pill ${defaultTarget === target ? "active" : ""}`}
                onClick={() => setDefaultTarget(target)}
              >
                {target}%
              </button>
            ))}
          </div>
        </section>

        <div className="more-actions">
          {Capacitor.getPlatform() === "android" && <AppUpdateAction />}
          <a href="https://github.com/jitendradara12/lazyportal/" target="_blank" rel="noopener noreferrer" className="more-action">
            <span className="more-action-icon" aria-hidden="true">
              <GitHubIcon />
            </span>
            <span className="more-action-label">Source code</span>
            <span className="more-action-trailing" aria-hidden="true">↗</span>
          </a>
          <button type="button" onClick={onLogout} className="more-action is-danger">
            <span className="more-action-icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </span>
            <span className="more-action-label">Logout</span>
          </button>
        </div>
        <p className="more-tagline">ad free and open source, always :)</p>
      </div>
    </div>
  );
}
