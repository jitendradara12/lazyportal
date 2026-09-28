import { features } from "@juet/core";
import { client } from "../lib/portal";
import { useFeature } from "../hooks/useFeature";
import { SectionError, UnknownData } from "../components/DataViews";
import type { SectionProps } from "../types";

export function NoduesSection({ session, onLogout }: SectionProps) {
  const nodues = useFeature<{ form: unknown; fee: unknown; activities: unknown }>({
    run: () => Promise.all([
      features.getNoDuesForm(client, session),
      features.getNoDuesFeeStatus(client, session),
      features.getNoDuesActivities(client, session),
    ]).then(([form, fee, activities]) => ({ form, fee, activities })),
    deps: [session],
    onUnauthorized: onLogout,
  });
  if (!nodues.data && !nodues.error) {
    if (!nodues.loading) return null;
    return (
      <section className="card" id="nodues" aria-busy="true">
        <h2>No-dues status</h2>
        <p className="muted">Loading…</p>
      </section>
    );
  }
  return (
    <section className="card" id="nodues">
      <h2>No-dues status</h2>
      {nodues.data && (
        <>
          <h3>Form</h3><UnknownData data={nodues.data.form} />
          <h3>Fee</h3><UnknownData data={nodues.data.fee} />
          <h3>Activities</h3><UnknownData data={nodues.data.activities} />
        </>
      )}
      {nodues.error && <SectionError label="No-dues" error={nodues.error} retry={nodues.retry} />}
    </section>
  );
}
