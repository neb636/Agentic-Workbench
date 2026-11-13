import type { GuardResult, SendGuard, SendInput } from "@dimsum/sdk";
import { Registry } from "./registry";

export class SendGuardRegistry extends Registry<SendGuard> {
  /** Every guard that matched, in order. A guard that throws is reported and treated as not matching. */
  check(input: SendInput): GuardResult[] {
    return this.list(input.workspaceId)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .flatMap((guard) => {
        try { return guard.check(input) ?? []; }
        catch (error) { console.error(`Send guard ${guard.id} failed:`, error); return []; }
      });
  }
}
