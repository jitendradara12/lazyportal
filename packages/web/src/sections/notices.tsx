import { features } from "@juet/core";
import { client } from "../lib/portal";
import { useFeature } from "../hooks/useFeature";
import { SectionError } from "../components/DataViews";
import type { SectionProps } from "../types";

export function NoticesSection({ session, onLogout }: SectionProps) {
  const notices = useFeature<string[]>({
    run: () => features.getNotices(client),
    deps: [session],
    onUnauthorized: onLogout,
  });
  if (!notices.data && !notices.error) {
    if (!notices.loading) return null;
    return (
      <section className="card" id="notices" aria-busy="true">
        <h2>Announcements</h2>
        <p className="muted">Loading…</p>
      </section>
    );
  }
  if (notices.error) return <SectionError label="Announcements" error={notices.error} retry={notices.retry} />;
  if (!notices.data || notices.data.length === 0) return null;
  return (
    <section className="card" id="notices" aria-label="Announcements">
      <h2>Announcements</h2>
      {notices.data.map((n, i) => (
        <p key={i} className="muted">{String(n)}</p>
      ))}
    </section>
  );
}
