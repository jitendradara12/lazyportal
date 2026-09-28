import { createRoot } from "react-dom/client";
import { useSession } from "./hooks/useSession";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles.css";

function App() {
  const { session, save, logout } = useSession();
  if (!session) return <LoginPage onDone={save} />;
  return (
    <DashboardPage
      session={session}
      onLogout={logout}
      onSelectInstitute={(instituteid) => {
        const match = ((session.institutelist as { value?: string; label?: string }[] | undefined) ?? [])
          .find((o) => String(o.value) === instituteid);
        save({ ...session, instituteid, institutename: match?.label ?? session.institutename });
      }}
    />
  );
}

const el = document.getElementById("root");
if (!el) throw new Error("#root element missing");

createRoot(el).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
