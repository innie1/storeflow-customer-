import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

/**
 * Last-resort UI guard for production PWAs.
 *
 * This does not swallow errors silently: it logs the error and gives the
 * customer a recoverable screen instead of leaving a blank white page.
 */
export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : 'Something went wrong.',
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('[StoreFlow] Unhandled render error:', error, info.componentStack);
  }

  private recover = () => {
    this.setState({ hasError: false, message: '' });
  };

  private reload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main
        role="alert"
        style={{
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          padding: 24,
          background: 'var(--sf-bg, #fbf9f9)',
          color: 'var(--sf-text, #1a1c1e)',
          fontFamily: 'Inter, sans-serif',
        }}
      >
        <section
          style={{
            width: 'min(100%, 420px)',
            padding: 24,
            border: '1px solid var(--sf-border, #e5e7eb)',
            borderRadius: 'var(--sf-radius-lg, 18px)',
            background: 'var(--sf-surface, #fff)',
            boxShadow: 'var(--sf-shadow-md, 0 8px 24px rgba(0,0,0,.07))',
            textAlign: 'center',
          }}
        >
          <h1 style={{ margin: '0 0 8px', fontSize: 22 }}>StoreFlow needs a quick refresh</h1>
          <p style={{ margin: '0 0 20px', color: 'var(--sf-text-muted, #6b7280)', lineHeight: 1.5 }}>
            We hit an unexpected problem. Your saved cart and order information are kept locally where possible.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={this.recover}
              className="sf-touch-target sf-focus-ring"
              style={{ border: 0, borderRadius: 12, padding: '0 18px', fontWeight: 700, cursor: 'pointer' }}
            >
              Try again
            </button>
            <button
              type="button"
              onClick={this.reload}
              className="sf-touch-target sf-focus-ring"
              style={{ border: '1px solid var(--sf-border, #e5e7eb)', borderRadius: 12, padding: '0 18px', background: 'transparent', fontWeight: 700, cursor: 'pointer' }}
            >
              Reload app
            </button>
          </div>
          {import.meta.env.DEV && this.state.message ? (
            <pre style={{ marginTop: 20, overflow: 'auto', textAlign: 'left', fontSize: 11, opacity: 0.7 }}>
              {this.state.message}
            </pre>
          ) : null}
        </section>
      </main>
    );
  }
}
