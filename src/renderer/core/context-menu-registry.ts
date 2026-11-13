import type { ContextAction, MenuContext, MenuContribution } from "@dimsum/sdk";
import { Registry } from "./registry";

export type { MenuContext, MenuContribution, TextSelection } from "@dimsum/sdk";

export class ContextMenuRegistry extends Registry<MenuContribution> {
  forTarget(context: MenuContext): ContextAction[] {
    return this.list(context.workspace.id).filter((c) => c.kind === context.kind).flatMap((c) => c.items(context));
  }
}
