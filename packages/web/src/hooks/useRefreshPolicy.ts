import { useEffect, useState } from "react";
import { getRefreshPolicy, type RefreshPage } from "../lib/portal";
import { REFRESH_POLICIES } from "../lib/refreshPolicy";
import type { RefreshPolicy } from "../lib/refreshPolicy";

/** Pending capabilities use proxy limits. Handlers also resolve before sending. */
export function useRefreshPolicy(page: RefreshPage) {
  const [policy, setPolicy] = useState<RefreshPolicy>(REFRESH_POLICIES.proxy);
  useEffect(() => {
    let active = true;
    void getRefreshPolicy(page).then((resolved) => { if (active) setPolicy(resolved); });
    return () => { active = false; };
  }, [page]);
  return policy;
}
