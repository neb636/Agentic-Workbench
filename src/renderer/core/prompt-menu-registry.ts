import type { PromptMenuContext, PromptMenuDefinition } from "@dimsum/sdk";
import { duplicateOptionIds, type PromptOptionDefinition } from "../../shared/prompt-options";
import { Registry } from "./registry";

export type { PromptMenuContext, PromptMenuDefinition, PromptOptionTag } from "@dimsum/sdk";

export interface PromptMenuOptions {
  menu: PromptMenuDefinition;
  options: PromptOptionDefinition[];
}

export class PromptMenuRegistry extends Registry<PromptMenuDefinition> {
  ordered(workspaceId?: string): PromptMenuDefinition[] {
    return this.list(workspaceId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  /** Option ids are shared across menus because conditions may reference options in other menus. */
  resolve(context: PromptMenuContext): PromptMenuOptions[] {
    const menus = this.ordered(context.workspaceId).map((menu) => ({ menu, options: menu.options(context) }));
    const duplicates = duplicateOptionIds(menus.flatMap((item) => item.options));
    if (duplicates.length) console.warn(`Prompt options share ids across menus: ${duplicates.join(", ")}`);
    return menus;
  }
}
