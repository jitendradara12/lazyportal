import { usePageRefresh } from "../hooks/usePageRefresh";
import { ATTENDANCE_TARGETS, useDefaultAttendanceTarget } from "../hooks/useDefaultAttendanceTarget";
import { SECTIONS } from "../sections";
import { TopBar } from "../components/AppBar";
import { titleCase } from "../components/DataViews";
import { OfficialPortalEntry } from "../components/OfficialPortalEntry";
import { selectionHaptic } from "../lib/nativeInteractions";
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
          <h2 id="default-attendance-target">Default attendance target</h2>
          <p>Start each subject’s attendance calculator at your preferred target.</p>
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
          <a href="https://github.com/jitendradara12/lazyportal/" target="_blank" rel="noopener noreferrer" className="more-action">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            <span>Source code</span>
          </a>
          <button type="button" onClick={onLogout} className="more-action is-danger">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            <span>Logout</span>
          </button>
        </div>
        <p className="more-tagline">Free and open source, always.</p>
      </div>
    </div>
  );
}
