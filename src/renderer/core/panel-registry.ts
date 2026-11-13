import type { PanelDefinition } from "@dimsum/sdk";
import { Registry } from "./registry";

export type { PanelDefinition, PanelProps } from "@dimsum/sdk";

export class PanelRegistry extends Registry<PanelDefinition> {
  ordered(workspaceId?: string): PanelDefinition[] {
    return this.list(workspaceId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }
}
