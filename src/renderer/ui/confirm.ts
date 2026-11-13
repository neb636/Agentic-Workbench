/** A destructive action the person confirms: what goes, what is lost, and what the button says. */
import type { DestructiveConfirmation } from "@dimsum/sdk";
export type { DestructiveConfirmation } from "@dimsum/sdk";

type Pending = DestructiveConfirmation & { resolve: (confirmed: boolean) => void };
let pending: Pending | undefined;
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };

/** Asks before something is removed; resolves false when cancelled or dismissed. One question at a time: a new one cancels the last. */
export function confirmDestructive(request: DestructiveConfirmation): Promise<boolean> {
  pending?.resolve(false);
  return new Promise((resolve) => { pending = { ...request, resolve }; emit(); });
}

export function answerConfirmation(confirmed: boolean): void {
  const current = pending;
  pending = undefined;
  current?.resolve(confirmed);
  emit();
}

export const pendingConfirmation = {
  subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  get: (): DestructiveConfirmation | undefined => pending,
};
