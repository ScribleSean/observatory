import { Component, type ErrorInfo, type ReactNode } from 'react';

/** One block, or one view, that failed to draw says so in its own place and leaves the rest of the page alone. */
export class BlockBoundary extends Component<{ name: string; children?: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  // Callers key a boundary by what it draws (the view, the selected session), so a new one starts fresh.
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown, info: ErrorInfo) { console.error(`${this.props.name} could not be drawn`, error, info.componentStack); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <section className="blk" role="alert"><div className="empty"><b>{this.props.name} could not be drawn</b>The rest of the page is unaffected. Reload to try again.</div></section>;
  }
}
