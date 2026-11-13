// Declarative prompt options. Definitions are plain data so built-in options and
// user-managed options share one schema; the engine below is pure.

export type PromptCondition =
  | { kind: "all"; conditions: PromptCondition[] }
  | { kind: "any"; conditions: PromptCondition[] }
  | { kind: "not"; condition: PromptCondition }
  | { kind: "isOn"; option: string }
  | { kind: "isChoice"; option: string; choice: string }
  /** The composer sends to this agent harness (an agent provider id such as `claude.cli`). */
  | { kind: "harness"; harness: string };

export interface PromptOptionChoice {
  id: string;
  label: string;
  text: string;
  description?: string;
}

export interface OptionFields {
  label: string;
  description?: string;
  category?: string;
  when?: PromptCondition;
  /** Presentation hint for select options. */
  display?: "list" | "segmented" | "dropdown";
  /** Overrides the owning menu's reset policy after a successful send. */
  resetAfterSend?: boolean;
}

export type PromptOptionSpec =
  | { kind: "toggle"; defaultOn: boolean; text: string }
  | { kind: "select"; defaultChoice: string; choices: PromptOptionChoice[] }
  | { kind: "multiSelect"; defaultChoices: string[]; choices: PromptOptionChoice[] }
  | { kind: "text"; placeholder: string; defaultValue: string; maxLength: number; template: string };

export type PromptOptionDefinition = { id: string } & OptionFields & PromptOptionSpec;
export type PromptOptionValue = boolean | string | string[];
export type PromptSelections = Record<string, PromptOptionValue>;

const option = (id: string, fields: OptionFields, spec: PromptOptionSpec): PromptOptionDefinition => ({
  id,
  label: fields.label,
  description: fields.description,
  category: fields.category,
  when: fields.when,
  display: fields.display,
  resetAfterSend: fields.resetAfterSend,
  ...spec,
});

export const toggle = (id: string, fields: OptionFields & { text: string; defaultOn?: boolean }): PromptOptionDefinition =>
  option(id, fields, { kind: "toggle", defaultOn: fields.defaultOn ?? false, text: fields.text });

export const select = (id: string, fields: OptionFields & { choices: PromptOptionChoice[]; default?: string }): PromptOptionDefinition =>
  option(id, fields, { kind: "select", defaultChoice: fields.default ?? fields.choices[0]?.id ?? "", choices: fields.choices });

export const multiSelect = (id: string, fields: OptionFields & { choices: PromptOptionChoice[]; defaults?: string[] }): PromptOptionDefinition =>
  option(id, fields, { kind: "multiSelect", defaultChoices: fields.defaults ?? [], choices: fields.choices });

export const textInput = (
  id: string,
  fields: OptionFields & { template: string; placeholder?: string; default?: string; maxLength?: number },
): PromptOptionDefinition =>
  option(id, fields, {
    kind: "text",
    placeholder: fields.placeholder ?? "",
    defaultValue: fields.default ?? "",
    maxLength: fields.maxLength ?? 120,
    template: fields.template,
  });

export const choice = (id: string, label: string, text = "", description?: string): PromptOptionChoice => ({ id, label, text, description });

export const allOf = (conditions: PromptCondition[]): PromptCondition => ({ kind: "all", conditions });
export const anyOf = (conditions: PromptCondition[]): PromptCondition => ({ kind: "any", conditions });
export const not = (condition: PromptCondition): PromptCondition => ({ kind: "not", condition });
export const isOn = (optionId: string): PromptCondition => ({ kind: "isOn", option: optionId });
export const isChoice = (optionId: string, choiceId: string): PromptCondition => ({ kind: "isChoice", option: optionId, choice: choiceId });
export const harness = (providerId: string): PromptCondition => ({ kind: "harness", harness: providerId });

/** What conditions may ask about besides the selections themselves. */
export interface PromptConditionContext {
  /** The agent harness the composer sends to; `harness(...)` conditions are false while it is unknown. */
  providerId?: string;
}

export function defaultValue(definition: PromptOptionDefinition): PromptOptionValue {
  switch (definition.kind) {
    case "toggle": return definition.defaultOn;
    case "select": return definition.defaultChoice;
    case "multiSelect": return definition.defaultChoices;
    case "text": return definition.defaultValue;
  }
}

/** The selected value, coerced to the option's shape; stale or invalid selections fall back to the default. */
export function valueOf(definition: PromptOptionDefinition, selections: PromptSelections): PromptOptionValue {
  const value = selections[definition.id];
  switch (definition.kind) {
    case "toggle": return typeof value === "boolean" ? value : definition.defaultOn;
    case "select": return typeof value === "string" && definition.choices.some((c) => c.id === value) ? value : definition.defaultChoice;
    case "multiSelect": return Array.isArray(value)
      ? value.filter((id) => definition.choices.some((c) => c.id === id))
      : definition.defaultChoices;
    case "text": return typeof value === "string" ? value.slice(0, definition.maxLength) : definition.defaultValue;
  }
}

/** The text an option adds to the prompt for its current value; empty when it adds nothing. */
export function optionText(definition: PromptOptionDefinition, value: PromptOptionValue): string {
  switch (definition.kind) {
    case "toggle": return value === true ? definition.text.trim() : "";
    case "select": return definition.choices.find((c) => c.id === value)?.text.trim() ?? "";
    case "multiSelect": return definition.choices
      .filter((c) => Array.isArray(value) && value.includes(c.id))
      .map((c) => c.text.trim()).filter(Boolean).join("\n");
    case "text": return typeof value === "string" && value.trim() ? definition.template.replaceAll("{{value}}", value.trim()).trim() : "";
  }
}

export interface PromptOptionEvaluator {
  isVisible: (optionId: string) => boolean;
  evaluate: (condition: PromptCondition) => boolean;
  value: (definition: PromptOptionDefinition) => PromptOptionValue;
}

/**
 * Conditions may reference any option in the same set. A hidden option counts as off,
 * so dependent options disappear with it; cyclic or unknown references are false.
 */
export function createEvaluator(options: PromptOptionDefinition[], selections: PromptSelections, context: PromptConditionContext = {}): PromptOptionEvaluator {
  const byId = new Map(options.map((definition) => [definition.id, definition]));
  const visibility = new Map<string, boolean>();
  const visiting = new Set<string>();
  const value = (definition: PromptOptionDefinition) => valueOf(definition, selections);
  const isVisible = (optionId: string): boolean => {
    const cached = visibility.get(optionId);
    if (cached !== undefined) return cached;
    const definition = byId.get(optionId);
    if (!definition || visiting.has(optionId)) return false;
    visiting.add(optionId);
    const visible = !definition.when || evaluate(definition.when);
    visiting.delete(optionId);
    visibility.set(optionId, visible);
    return visible;
  };
  const evaluate = (condition: PromptCondition): boolean => {
    switch (condition.kind) {
      case "all": return condition.conditions.every(evaluate);
      case "any": return condition.conditions.some(evaluate);
      case "not": return !evaluate(condition.condition);
      case "isOn": {
        const definition = byId.get(condition.option);
        if (!definition || !isVisible(definition.id)) return false;
        const current = value(definition);
        if (definition.kind === "select") return optionText(definition, current) !== "";
        return Array.isArray(current) ? current.length > 0 : typeof current === "string" ? current.trim() !== "" : current;
      }
      case "isChoice": {
        const definition = byId.get(condition.option);
        if (!definition || !isVisible(definition.id)) return false;
        const current = value(definition);
        return Array.isArray(current) ? current.includes(condition.choice) : current === condition.choice;
      }
      case "harness": return context.providerId === condition.harness;
    }
  };
  return { isVisible, evaluate, value };
}

export interface ResolvedPromptOption {
  id: string;
  label: string;
  /** What was chosen, for labels: the choice names for selects, otherwise the option label. */
  summary: string;
  text: string;
}

function summaryOf(definition: PromptOptionDefinition, value: PromptOptionValue): string {
  if (definition.kind === "select" || definition.kind === "multiSelect") {
    const chosen = definition.choices.filter((c) => (Array.isArray(value) ? value.includes(c.id) : c.id === value)).map((c) => c.label);
    return chosen.join(", ") || definition.label;
  }
  return definition.label;
}

export function resolveOptions(options: PromptOptionDefinition[], selections: PromptSelections, context = options, conditions: PromptConditionContext = {}): ResolvedPromptOption[] {
  const evaluator = createEvaluator(context, selections, conditions);
  return options
    .filter((definition) => evaluator.isVisible(definition.id))
    .map((definition) => {
      const current = evaluator.value(definition);
      return { id: definition.id, label: definition.label, summary: summaryOf(definition, current), text: optionText(definition, current) };
    })
    .filter((resolved) => resolved.text !== "");
}

/** Clears selections for options that reset after a send, returning them to their defaults. */
export function resetSelections(options: PromptOptionDefinition[], selections: PromptSelections, resetByDefault: boolean): PromptSelections {
  const next = { ...selections };
  for (const definition of options) {
    if (definition.resetAfterSend ?? resetByDefault) delete next[definition.id];
  }
  return next;
}

export function duplicateOptionIds(options: PromptOptionDefinition[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const definition of options) {
    if (seen.has(definition.id)) duplicates.add(definition.id);
    seen.add(definition.id);
  }
  return [...duplicates];
}
