import { features } from "@juet/core";
import { client } from "../lib/portal";
import { useFeature } from "../hooks/useFeature";
import { SectionError, UnknownData } from "../components/DataViews";
import type { SectionProps } from "../types";

export function HostelSection({ session, onLogout }: SectionProps) {
  const hostel = useFeature<{ present: unknown; authorities: unknown }>({
    run: () => features.getHostelDetail(client, session),
    deps: [session],
    onUnauthorized: onLogout,
  });
  if (!hostel.data && !hostel.error) return null;
  return (
    <section className="card" id="hostel">
      <h2>Hostel</h2>
      {hostel.data && (
        <>
          <UnknownData data={hostel.data.present} />
          <UnknownData data={hostel.data.authorities} />
        </>
      )}
      {hostel.error && <SectionError label="Hostel" error={hostel.error} retry={hostel.retry} />}
    </section>
  );
}
