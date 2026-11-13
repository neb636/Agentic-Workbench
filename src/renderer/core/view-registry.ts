import type { ViewDefinition } from "@dimsum/sdk";
import type { WorkbenchView } from "../../shared/models";
import { Registry } from "./registry";

export type { ViewComponentProps, ViewDefinition } from "@dimsum/sdk";

export class ViewRegistry extends Registry<ViewDefinition> {
  /** The definition that draws this view: its workspace's own first, then the global one. */
  of(view: WorkbenchView): ViewDefinition | undefined {
    return this.get(view.type, view.workspaceId);
  }
}
