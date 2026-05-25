import { Component, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  fallback?: ReactNode;
};

type State = {
  error: Error | null;
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("[ErrorBoundary] Uncaught render error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        this.props.fallback ?? (
          <div className="flex h-full w-full items-center justify-center bg-background text-foreground">
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-foreground/10 bg-foreground/5 px-8 py-6 text-center shadow-xl">
              <p className="text-sm font-medium">Something went wrong.</p>
              <p className="max-w-xs text-xs text-foreground/50">
                {this.state.error.message}
              </p>
              <button
                className="mt-1 rounded-lg bg-foreground/10 px-4 py-1.5 text-xs font-medium hover:bg-foreground/20"
                onClick={() => this.setState({ error: null })}
              >
                Try again
              </button>
            </div>
          </div>
        )
      );
    }

    return this.props.children;
  }
}
