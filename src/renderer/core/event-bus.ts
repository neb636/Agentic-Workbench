import type { Disposable, WorkbenchEventHandler, WorkbenchEventName, WorkbenchEvents } from "@dimsum/sdk";

/**
 * Notifications about what happened in the workbench. A handler that throws is reported and skipped: it never stops
 * the feature that emitted the event or the handlers after it.
 */
export class EventBus {
  private readonly handlers = new Map<WorkbenchEventName, Set<(event: never) => void>>();

  on<K extends WorkbenchEventName>(name: K, handler: WorkbenchEventHandler<K>): Disposable {
    let set = this.handlers.get(name);
    if (!set) { set = new Set(); this.handlers.set(name, set); }
    set.add(handler as (event: never) => void);
    return { dispose: () => { set.delete(handler as (event: never) => void); } };
  }

  emit<K extends WorkbenchEventName>(name: K, event: WorkbenchEvents[K]): void {
    for (const handler of [...(this.handlers.get(name) ?? [])]) {
      try { (handler as WorkbenchEventHandler<K>)(event); }
      catch (error) { console.error(`A "${name}" handler failed:`, error); }
    }
  }
}
