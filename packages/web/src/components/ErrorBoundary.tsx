import { Component, type ReactNode } from "react";
import { store } from "../lib/portal";

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <main style={{ padding: 24, fontFamily: "system-ui" }}>
          <h1>Something broke</h1>
          <p role="alert">{this.state.error.message}</p>
          <button onClick={() => this.setState({ error: null })}>Try again</button>{" "}
          <button onClick={() => location.reload()}>Reload</button>{" "}
          <button
            onClick={() => {
              store.clear();
              try {
                localStorage.removeItem("juet.portal.saved_pw");
              } catch {}
              location.reload();
            }}
          >
            Log out and reload
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}
