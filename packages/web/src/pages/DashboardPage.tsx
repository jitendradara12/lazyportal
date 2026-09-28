import { SECTIONS } from "../sections";
import type { Session } from "../types";

interface InstituteOption {
  value?: string;
  label?: string;
}

export function DashboardPage({ session, onLogout, onSelectInstitute }: {
  session: Session;
  onLogout: () => void;
  onSelectInstitute: (instituteid: string) => void;
}) {
  const institutes = (session.institutelist as InstituteOption[] | undefined) ?? [];
  return (
    <main className="dash">
      <header>
        <h1>Hi, {session.name ?? session.enrollmentno ?? "student"}</h1>
        {institutes.length > 1 && (
          <label className="semrow">
            Institute{" "}
            <select
              value={typeof session.instituteid === "string" ? session.instituteid : ""}
              onChange={(e) => onSelectInstitute(e.target.value)}
            >
              {institutes.map((o) => (
                <option key={String(o.value)} value={String(o.value)}>
                  {String(o.label ?? o.value)}
                </option>
              ))}
            </select>
          </label>
        )}
        <button onClick={onLogout}>Logout</button>
      </header>
      <nav className="group anchor-nav" aria-label="Sections">
        {SECTIONS.map(({ id, label }) => (
          <a key={id} href={`#${id}`}>{label}</a>
        ))}
      </nav>
      {SECTIONS.map(({ id, Component }) => (
        <Component key={`${id}:${typeof session.instituteid === "string" ? session.instituteid : ""}`} session={session} onLogout={onLogout} />
      ))}
    </main>
  );
}
