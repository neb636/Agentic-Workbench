import type { ComponentType } from "react";
import type { PromptContribution } from "../../shared/models";
import { duplicateOptionIds, type PromptOptionDefinition } from "../../shared/prompt-options";
import { Registry } from "./registry";

export interface PromptMenuContext {
  workspaceId: string;
  viewId: string;
}

/** A composer menu whose options add text before or after the user's prompt. */
export interface PromptMenuDefinition {
  id: string;
  label: string;
  description: string;
  icon: ComponentType<{ size?: number }>;
  order?: number;
  kind: PromptContribution["kind"];
  placement: "prepend" | "append";
  /** Whether options return to their defaults after a successful send; options may override it. */
  resetAfterSend: boolean;
  options: (context: PromptMenuContext) => PromptOptionDefinition[];
  /** Calls `listener` whenever `options` may return something different; returns an unsubscribe. */
  subscribe?: (listener: () => void) => () => void;
  /** A small marker shown beside an option, such as where it comes from. */
  optionTag?: (optionId: string, context: PromptMenuContext) => PromptOptionTag | undefined;
  manage?: { title: string; description: string; component: ComponentType<{ workspaceId: string; close: () => void }> };
}

export interface PromptOptionTag {
  label: string;
  icon: ComponentType<{ size?: number }>;
}

export interface PromptMenuOptions {
  menu: PromptMenuDefinition;
  options: PromptOptionDefinition[];
}

export class PromptMenuRegistry extends Registry<PromptMenuDefinition> {
  ordered(): PromptMenuDefinition[] {
    return this.list().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  /** Option ids are shared across menus because conditions may reference options in other menus. */
  resolve(context: PromptMenuContext): PromptMenuOptions[] {
    const menus = this.ordered().map((menu) => ({ menu, options: menu.options(context) }));
    const duplicates = duplicateOptionIds(menus.flatMap((item) => item.options));
    if (duplicates.length) console.warn(`Prompt options share ids across menus: ${duplicates.join(", ")}`);
    return menus;
  }
}
