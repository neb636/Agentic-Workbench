import { create } from "zustand";

export interface RegistryItem {
  id: string;
}

/** Bumped whenever any registry changes, so the shell re-renders when an extension adds or removes something. */
export const useRegistryRevision = create<{ revision: number }>(() => ({ revision: 0 }));
export const registryChanged = () => useRegistryRevision.setState((state) => ({ revision: state.revision + 1 }));
/** Re-renders the caller whenever a contribution is added or removed. */
export const useContributions = () => useRegistryRevision((state) => state.revision);

const key = (id: string, scope: string | undefined) => (scope ? `${scope}\0${id}` : id);

/**
 * Contributions by id. A contribution may belong to one workspace (`scope`, a workspace id): it is offered only there,
 * so two worktrees of one repository can each load their own copy of the same workspace extension.
 */
export class Registry<T extends RegistryItem> {
  private readonly items = new Map<string, { item: T; scope?: string }>();

  register(item: T, scope?: string): () => void {
    const id = key(item.id, scope);
    if (this.items.has(id) || (scope && this.items.has(item.id))) throw new Error(`Registration already exists: ${item.id}`);
    const entry = { item, scope };
    this.items.set(id, entry);
    registryChanged();
    return () => {
      if (this.items.get(id) !== entry) return;
      this.items.delete(id);
      registryChanged();
    };
  }

  /** The workspace's own contribution with this id, else the global one. */
  get(id: string, scope?: string): T | undefined {
    return (scope ? this.items.get(key(id, scope))?.item : undefined) ?? this.items.get(id)?.item;
  }

  /** Global contributions, plus those of the workspace `scope`. */
  list(scope?: string): T[] {
    return [...this.items.values()].filter((entry) => !entry.scope || entry.scope === scope).map((entry) => entry.item);
  }
}
