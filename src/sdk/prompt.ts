// The prompt-option DSL: composer menus are built from small typed functions and stay plain data.
import type { ComponentType } from "react";
import type { PromptContribution } from "../shared/models";
import type { PromptOptionDefinition } from "../shared/prompt-options";
import type { PromptMenuDefinition } from "./contributions";

export {
  allOf, anyOf, choice, harness, isChoice, isOn, multiSelect, not, select, textInput, toggle,
} from "../shared/prompt-options";
export type {
  OptionFields, PromptCondition, PromptOptionChoice, PromptOptionDefinition, PromptOptionValue, PromptSelections,
} from "../shared/prompt-options";

/** Puts options under one heading in their menu. An option's own `category` wins. */
export const group = (label: string, options: PromptOptionDefinition[]): PromptOptionDefinition[] =>
  options.map((option) => ({ ...option, category: option.category ?? label }));

/** A menu of fixed options. `items` may mix single options and `group(...)`s. */
export function promptMenu(fields: {
  id: string;
  label: string;
  description?: string;
  icon: ComponentType<{ size?: number }>;
  placement?: "prepend" | "append";
  kind?: PromptContribution["kind"];
  order?: number;
  resetAfterSend?: boolean;
  items: (PromptOptionDefinition | PromptOptionDefinition[])[];
}): PromptMenuDefinition {
  const options = fields.items.flat();
  return {
    id: fields.id,
    label: fields.label,
    description: fields.description ?? "",
    icon: fields.icon,
    order: fields.order,
    kind: fields.kind ?? "instruction",
    placement: fields.placement ?? "append",
    resetAfterSend: fields.resetAfterSend ?? false,
    options: () => options,
  };
}
