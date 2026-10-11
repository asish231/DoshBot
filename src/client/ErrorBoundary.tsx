import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/** Catches render errors so the SPA shows a recovery card instead of a white screen. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI crashed:', error.message, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#fff',
            padding: '24px',
          }}
        >
          <div
            style={{
              maxWidth: 460,
              border: '2px solid #000',
              background: '#fff',
              padding: '24px',
            }}
          >
            <h1 style={{ margin: '0 0 8px', fontSize: 18 }}>Something broke</h1>
            <p
              style={{
                margin: '0 0 12px',
                fontSize: 13,
                color: '#555',
                lineHeight: 1.5,
              }}
            >
              The interface hit an unexpected error. Your workspace and
              conversations are safe — reload to continue.
            </p>
            <pre
              style={{
                margin: '0 0 16px',
                fontSize: 11,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                color: '#b42318',
              }}
            >
              {this.state.error.message}
            </pre>
            <button
              type="button"
              className="primary"
              onClick={() => window.location.reload()}
            >
              Reload DoshBot
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
