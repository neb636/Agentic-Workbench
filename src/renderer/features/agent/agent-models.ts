import { create } from "zustand";
import type { AgentModelChoice, AgentModelSettings, AgentProviderInfo } from "../../../shared/models";

/** Models each provider's adapter offers, as reported by discovery. Not persisted. */
export const useAgentModels = create<Record<string, AgentModelChoice[]>>(() => ({}));

export function rememberAgentModels(providers: AgentProviderInfo[]): void {
  useAgentModels.setState(Object.fromEntries(providers.filter((item) => item.models?.length).map((item) => [item.id, item.models!])));
}

/**
 * The model and effort a new conversation launches with: the saved choice when the adapter still offers it,
 * otherwise null (the CLI's own defaults, no launch arguments).
 */
export function modelSettings(providerId: string, saved?: AgentModelSettings): AgentModelSettings | null {
  if (!saved) return null;
  const model = useAgentModels.getState()[providerId]?.find((choice) => choice.id === saved.model);
  if (!model) return null;
  return { model: model.id, effort: model.efforts.includes(saved.effort) ? saved.effort : model.efforts.includes("medium") ? "medium" : model.efforts[0] };
}

export function modelLabel(providerId: string, settings: AgentModelSettings | null): string {
  if (!settings) return "the CLI's default model";
  const model = useAgentModels.getState()[providerId]?.find((choice) => choice.id === settings.model);
  return `${model?.label ?? settings.model} ${settings.effort}`;
}
