import { Component, type ComponentType, type ReactNode } from "react";

interface BoundaryProps { extensionId: string; children: ReactNode }

/** Keeps a failing extension component from taking the workbench down with it. */
class ExtensionBoundary extends Component<BoundaryProps, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error(`Extension ${this.props.extensionId} failed to render:`, error); }
  render() {
    if (!this.state.error) return this.props.children;
    return <div className="extension-error" role="alert">
      <strong>{this.props.extensionId} stopped working here</strong>
      <p>{this.state.error.message}</p>
      <button type="button" className="link-button" onClick={() => this.setState({ error: undefined })}>Try again</button>
    </div>;
  }
}

/** The same component, drawn inside a boundary that names the extension it came from. */
export function guarded<P extends object>(extensionId: string, Inner: ComponentType<P>): ComponentType<P> {
  const Guarded = (props: P) => <ExtensionBoundary extensionId={extensionId}><Inner {...props} /></ExtensionBoundary>;
  Guarded.displayName = `Extension(${Inner.displayName ?? Inner.name ?? extensionId})`;
  return Guarded;
}
