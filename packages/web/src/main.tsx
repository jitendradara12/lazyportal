import { createRoot } from "react-dom/client";
import { Suspense, useEffect } from "react";
import { Analytics } from "@vercel/analytics/react";
import { useSession } from "./hooks/useSession";
import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./lazy";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { InstallBanner } from "./components/InstallBanner";
import "./styles.css";
import { initializeNativeInteractions, hideKeyboard } from "./lib/nativeInteractions";
import { useKeyboardViewport } from "./hooks/useKeyboardViewport";
import { applyThemePreference } from "./hooks/useThemePreference";

function App() {
  const { session, isExpired, isRecovering, save, logout } = useSession();
  useKeyboardViewport();
  useEffect(() => { if (session) hideKeyboard(); }, [Boolean(session)]);
  return (
    <>
      {!session ? <Suspense fallback={null}><LoginPage onDone={save} /></Suspense> : (
        <DashboardPage
          session={session}
          isExpired={isExpired}
          isRecovering={isRecovering}
          onLogout={logout}
          onSessionRenewed={save}
          onSelectInstitute={(instituteid) => {
            const match = ((session.institutelist as { value?: string; label?: string }[] | undefined) ?? [])
              .find((o) => String(o.value) === instituteid);
            save({ ...session, instituteid, institutename: match?.label ?? session.institutename });
          }}
        />
      )}
      <InstallBanner />
    </>
  );
}

const el = document.getElementById("root");
if (!el) throw new Error("#root element missing");
void initializeNativeInteractions();

// Sync data-theme attribute with stored preference or system color scheme
if (typeof window !== "undefined") {
  applyThemePreference();
  if (window.matchMedia) {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemChange = () => applyThemePreference();
    if (mq.addEventListener) {
      mq.addEventListener("change", onSystemChange);
    } else if (mq.addListener) {
      mq.addListener(onSystemChange);
    }
  }
  window.addEventListener("storage", (e) => {
    if (e.key === "juet.portal.theme" || e.key === null) applyThemePreference();
  });
}

createRoot(el).render(
  <ErrorBoundary>
    <App />
    <Analytics />
  </ErrorBoundary>
);

if (typeof window !== "undefined" && "serviceWorker" in navigator && import.meta.env.PROD) {
  const isNative =
    typeof (globalThis as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
      ?.isNativePlatform === "function"
      ? (globalThis as unknown as { Capacitor: { isNativePlatform: () => boolean } }).Capacitor.isNativePlatform()
      : false;
  if (!isNative) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
  }
}

// Production-only Cloudflare Web Analytics (avoids dev/e2e test network and CORS failures).
// Injected after load so the third-party connection never competes with the app's own bundles.
if (
  typeof window !== "undefined" &&
  import.meta.env.PROD &&
  !["localhost", "127.0.0.1", "0.0.0.0"].includes(window.location.hostname)
) {
  const inject = () => {
    const cf = document.createElement("script");
    cf.defer = true;
    cf.src = "https://static.cloudflareinsights.com/beacon.min.js";
    cf.setAttribute("data-cf-beacon", '{"token": "5fccd3a60a2841158d9930b0680d958d"}');
    document.head.appendChild(cf);
  };
  if (document.readyState === "complete") inject();
  else window.addEventListener("load", inject, { once: true });
}
