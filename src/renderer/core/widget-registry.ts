import type { WidgetDefinition } from "@dimsum/sdk";
import { Registry } from "./registry";

export type { WidgetDefinition, WidgetProps } from "@dimsum/sdk";

export class WidgetRegistry extends Registry<WidgetDefinition> {
  forSlot(slot: string, workspaceId?: string): WidgetDefinition[] {
    return this.list(workspaceId)
      .filter((item) => item.slot === slot)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }
}
