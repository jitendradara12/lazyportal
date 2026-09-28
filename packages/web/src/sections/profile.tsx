import { features } from "@juet/core";
import { client } from "../lib/portal";
import { useFeature } from "../hooks/useFeature";
import { AutoTable, SectionError, UnknownData, personalScalars, prettyKey } from "../components/DataViews";
import type { SectionProps } from "../types";

/** Personal info + medical + disciplinary. One profile section. */
export function ProfileSection({ session, onLogout }: SectionProps) {
  const personal = useFeature<{ general: Record<string, unknown> | null; qualification?: unknown }>({
    run: () => features.getPersonalInfo(client, session),
    deps: [session],
    onUnauthorized: onLogout,
  });
  const medical = useFeature<unknown>({
    run: () => features.getMedicalInfo(client, session),
    deps: [session],
    onUnauthorized: onLogout,
  });
  const disciplinary = useFeature<Record<string, unknown>[]>({
    run: () => features.getDisciplinary(client, session),
    deps: [session],
    onUnauthorized: onLogout,
  });

  const scalars = personalScalars(personal.data?.general ?? null);
  const loading = personal.loading || medical.loading || disciplinary.loading;
  if (scalars.length === 0 && !personal.error && medical.data == null && !medical.error
    && !disciplinary.data && !disciplinary.error) {
    if (!loading) return null;
    return (
      <section className="card personal" id="profile" aria-busy="true">
        <h2>Profile</h2>
        <p className="muted">Loading…</p>
      </section>
    );
  }
  return (
    <section className="card personal" id="profile">
      <h2>Profile</h2>
      {scalars.length > 0 && (
        <dl>
          {scalars.map(([k, v]) => (
            <div key={k}><dt>{prettyKey(k)}</dt><dd>{v}</dd></div>
          ))}
        </dl>
      )}
      {personal.error && <SectionError label="Personal info" error={personal.error} retry={personal.retry} />}
      {Array.isArray(personal.data?.qualification) && personal.data.qualification.length > 0 && (
        <>
          <h3>Qualification</h3>
          <AutoTable rows={personal.data.qualification as Record<string, unknown>[]} />
        </>
      )}
      {(medical.data !== null && medical.data !== undefined) || medical.error ? (
        <>
          <h3>Medical</h3>
          {medical.data != null && <UnknownData data={medical.data} />}
          {medical.error && <SectionError label="Medical info" error={medical.error} retry={medical.retry} />}
        </>
      ) : null}
      {disciplinary.data && disciplinary.data.length === 0 && !disciplinary.error && (
        <p className="muted">No disciplinary records.</p>
      )}
      {disciplinary.error && <SectionError label="Disciplinary" error={disciplinary.error} retry={disciplinary.retry} />}
    </section>
  );
}
