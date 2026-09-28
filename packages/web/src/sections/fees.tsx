import { features } from "@juet/core";
import { client } from "../lib/portal";
import { useFeature } from "../hooks/useFeature";
import { AutoTable, SectionError, num } from "../components/DataViews";
import type { SectionProps } from "../types";

interface PayslipRow {
  currencycode?: string;
  dueamount?: string | number;
}

function payslipTotals(rows: PayslipRow[]): { currency: string; total: number }[] {
  const sums = new Map<string, number>();
  for (const r of rows) {
    const cur = r.currencycode ?? "";
    sums.set(cur, (sums.get(cur) ?? 0) + num(r.dueamount));
  }
  return [...sums.entries()].map(([currency, total]) => ({ currency, total }));
}

export function FeesSection({ session, onLogout }: SectionProps) {
  const fee = useFeature<{ dueamount?: string | number }[]>({
    run: () => features.getFeeSummary(client, session),
    deps: [session],
    onUnauthorized: onLogout,
  });
  const payslip = useFeature<PayslipRow[]>({
    run: () => features.getPayslipDues(client, session),
    deps: [session],
    onUnauthorized: onLogout,
  });

  const due = fee.data ? fee.data.reduce((a, r) => a + num(r.dueamount), 0) : null;
  const totals = payslip.data && payslip.data.length > 0 ? payslipTotals(payslip.data) : [];
  const events = useFeature<Record<string, unknown>[]>({
    run: () => features.getFeeEvents(client, session),
    deps: [session],
    onUnauthorized: onLogout,
  });
  return (
    <section className="card" id="fees">
      <h2>Fees</h2>
      {due !== null && due > 0 && <p className="due">Fee due: ₹{due}</p>}
      {totals.length > 0 && (
        <p className="muted">Payslip due: {totals.map((t) => `${t.currency} ${t.total}`.trim()).join(" · ")}</p>
      )}
      {!fee.loading && !payslip.loading && !fee.error && !payslip.error && due !== null && due <= 0 && totals.length === 0 && (
        <p className="muted">No dues.</p>
      )}
      {(fee.loading || payslip.loading) && due === null && totals.length === 0 && (
        <p className="muted">Loading…</p>
      )}
      {fee.error && <SectionError label="Fee summary" error={fee.error} retry={fee.retry} />}
      {payslip.error && <SectionError label="Payslip dues" error={payslip.error} retry={payslip.retry} />}
      {events.data && events.data.length > 0 && (
        <>
          <h3>Active fee events</h3>
          <AutoTable rows={events.data} />
        </>
      )}
      {events.error && <SectionError label="Fee events" error={events.error} retry={events.retry} />}
    </section>
  );
}
