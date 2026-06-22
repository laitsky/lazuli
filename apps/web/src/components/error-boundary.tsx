import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Catches render-time failures so one broken route or chart does not collapse
 * the entire application shell.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(
      JSON.stringify({
        level: 'error',
        module: 'web',
        msg: 'React error boundary caught an error',
        error: error.message,
        componentStack: info.componentStack,
      })
    );
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
          <section className="max-w-md space-y-4 text-center">
            <h1 className="text-2xl font-semibold">Something went wrong</h1>
            <p className="text-sm text-muted-foreground">
              The app shell is still running. Refresh the page to reload market data.
            </p>
            <Button onClick={() => window.location.reload()}>Refresh</Button>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}
