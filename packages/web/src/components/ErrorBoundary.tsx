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
          <p>{this.state.error.message}</p>
          <button
            onClick={() => {
              store.clear();
              location.reload();
            }}
          >
            Reset session and reload
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}
