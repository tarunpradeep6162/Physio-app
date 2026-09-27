import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode }
interface State { failed: boolean }

/** A new deployment can remove a lazy chunk while an older tab is still open. Keep a recovery
 * action visible instead of leaving the entire app blank. Never reload automatically: unsaved
 * form input may still be present in the tab. */
export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State { return { failed: true }; }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    console.error('Unable to open this screen', error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main id="main" className="page" role="alert" style={{ maxWidth: 560, margin: '3rem auto' }}>
        <div className="card" style={{ padding: '1.5rem' }}>
          <h1>This screen could not load</h1>
          <p>The app may have been updated while this page was open. Any answers already saved will still be here. Copy any unsaved text before refreshing.</p>
          <button className="btn primary" onClick={() => window.location.reload()}>Refresh app</button>
        </div>
      </main>
    );
  }
}
