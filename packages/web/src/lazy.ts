// Code-split boundaries kept out of the startup bundle. Each chunk loads on first use; `prefetchIdle`
// warms the ones a signed-in user is likely to need once the first screen has settled.
import { lazy } from "react";
import { lazyImport } from "./lib/lazyImport";
import { prefetchTabs } from "./sections";

const loadLogin = lazyImport(() => import("./pages/LoginPage"));
const loadMore = lazyImport(() => import("./pages/MorePage"));
const loadReconnect = lazyImport(() => import("./components/ReconnectModal"));
const loadSubjectSheet = lazyImport(() => import("./components/SubjectDetailSheet"));

export const LoginPage = lazy(() => loadLogin().then((m) => ({ default: m.LoginPage })));
export const MorePage = lazy(() => loadMore().then((m) => ({ default: m.MorePage })));
export const ReconnectModal = lazy(() => loadReconnect().then((m) => ({ default: m.ReconnectModal })));
export const SubjectDetailSheet = lazy(() => loadSubjectSheet().then((m) => ({ default: m.SubjectDetailSheet })));

/** Runs once per page load, when the browser is idle; skipped when the user asked to save data. */
let prefetched = false;
export function prefetchIdle() {
  if (prefetched) return;
  prefetched = true;
  const saveData = (navigator as { connection?: { saveData?: boolean } }).connection?.saveData;
  if (saveData) return;
  const run = () => {
    prefetchTabs();
    for (const load of [loadMore, loadSubjectSheet, loadReconnect]) void load().catch(() => {});
  };
  if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 4000 });
  else setTimeout(run, 2000);
}
