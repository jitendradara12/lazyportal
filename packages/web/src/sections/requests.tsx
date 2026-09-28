import { useState } from "react";
import { features } from "@juet/core";
import { client } from "../lib/portal";
import { useFeature } from "../hooks/useFeature";
import { SectionError } from "../components/DataViews";
import type { SectionProps } from "../types";

interface PendingRow {
  requestno?: string;
  servicecode?: string;
  servicename?: string;
  remarksbystudents?: string;
  charge?: string | number;
  quantity?: string | number;
  feeamounttobepaid?: string | number;
}

const REQ_STATUSES = ["pending", "approved", "closed", "paid", "withdrawn", "cancelled"] as const;
type ReqStatus = (typeof REQ_STATUSES)[number];

function reqLabel(s: ReqStatus): string {
  return s[0].toUpperCase() + s.slice(1);
}

export function RequestsSection({ session, onLogout }: SectionProps) {
  const [reqStatus, setReqStatus] = useState<ReqStatus>("pending");
  const requests = useFeature<PendingRow[]>({
    run: () => {
      switch (reqStatus) {
        case "approved": return features.getApprovedRequests(client, session);
        case "closed": return features.getClosedRequests(client, session);
        case "paid": return features.getPaidRequests(client, session);
        case "withdrawn": return features.getWithdrawnRequests(client, session);
        case "cancelled": return features.getCancelledRequests(client, session);
        default: return features.getPendingServiceRequests(client, session);
      }
    },
    deps: [session, reqStatus],
    onUnauthorized: onLogout,
  });
  if (!requests.data && !requests.error) return null;
  return (
    <section className="card" id="requests">
      <h2>Service requests</h2>
      <label className="semrow">
        Status{" "}
        <select value={reqStatus} onChange={(e) => setReqStatus(e.target.value as ReqStatus)}>
          {REQ_STATUSES.map((s) => (
            <option key={s} value={s}>{reqLabel(s)}</option>
          ))}
        </select>
      </label>
      {requests.data && requests.data.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Request</th><th>Code</th><th>Service</th><th>Remarks</th><th>Charge</th><th>Qty</th><th>Fee</th></tr>
            </thead>
            <tbody>
              {requests.data.map((r, i) => (
                <tr key={i}>
                  <td>{r.requestno}</td><td>{r.servicecode}</td><td>{r.servicename}</td><td>{r.remarksbystudents}</td><td>{String(r.charge ?? "")}</td><td>{String(r.quantity ?? "")}</td><td>{String(r.feeamounttobepaid ?? "")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {requests.data && requests.data.length === 0 && !requests.error && (
        <p className="muted">No {reqStatus} service requests.</p>
      )}
      {requests.error && <SectionError label="Service requests" error={requests.error} retry={requests.retry} />}
    </section>
  );
}
