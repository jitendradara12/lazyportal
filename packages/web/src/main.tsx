import { createRoot } from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import { useSession } from "./hooks/useSession";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { InstallBanner } from "./components/InstallBanner";
import "./styles.css";

function App() {
  const { session, isExpired, save, logout } = useSession();
  return (
    <>
      {!session ? <LoginPage onDone={save} /> : (
        <DashboardPage
          session={session}
          isExpired={isExpired}
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

