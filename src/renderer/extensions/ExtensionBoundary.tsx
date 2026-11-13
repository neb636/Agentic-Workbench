import { Component, type ComponentType, type ReactNode } from "react";

interface BoundaryProps { extensionId: string; children: ReactNode; /** Shown instead of the error card (an icon has no room for one). */ fallback?: ReactNode }

/** Keeps a failing extension component from taking the workbench down with it. */
class ExtensionBoundary extends Component<BoundaryProps, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error(`Extension ${this.props.extensionId} failed to render:`, error); }
  render() {
    if (!this.state.error) return this.props.children;
    if ("fallback" in this.props) return this.props.fallback;
    return <div className="extension-error" role="alert">
      <strong>{this.props.extensionId} stopped working here</strong>
      <p>{this.state.error.message}</p>
      <button type="button" className="link-button" onClick={() => this.setState({ error: undefined })}>Try again</button>
    </div>;
  }
}

const icons = new Map<string, WeakMap<ComponentType<never>, ComponentType<never>>>();

/** An extension's icon, drawn inside a boundary that leaves its spot empty if it fails. The same icon keeps one wrapper. */
export function guardedIcon<P extends object>(extensionId: string, Icon: ComponentType<P>): ComponentType<P> {
  const cache = icons.get(extensionId) ?? new WeakMap();
  icons.set(extensionId, cache);
  const known = cache.get(Icon as ComponentType<never>) as ComponentType<P> | undefined;
  if (known) return known;
  const Guarded = (props: P) => <ExtensionBoundary extensionId={extensionId} fallback={null}><Icon {...props} /></ExtensionBoundary>;
  Guarded.displayName = `ExtensionIcon(${Icon.displayName ?? Icon.name ?? extensionId})`;
  cache.set(Icon as ComponentType<never>, Guarded as ComponentType<never>);
  return Guarded;
}

/** Content an extension handed over already rendered (a menu item's icon, a dialog's detail), contained the same way. */
export function guardedNode(extensionId: string, node: ReactNode): ReactNode {
  return node == null ? node : <ExtensionBoundary extensionId={extensionId} fallback={null}>{node}</ExtensionBoundary>;
}

/** The same component, drawn inside a boundary that names the extension it came from. */
export function guarded<P extends object>(extensionId: string, Inner: ComponentType<P>): ComponentType<P> {
  const Guarded = (props: P) => <ExtensionBoundary extensionId={extensionId}><Inner {...props} /></ExtensionBoundary>;
  Guarded.displayName = `Extension(${Inner.displayName ?? Inner.name ?? extensionId})`;
  return Guarded;
}
