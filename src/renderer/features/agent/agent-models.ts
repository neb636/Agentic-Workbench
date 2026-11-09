import { create } from "zustand";
import type { AgentModelChoice, AgentModelSettings, AgentProviderInfo } from "../../../shared/models";

/** Models each provider's CLI currently offers, from discovery and its background refreshes. Not persisted. */
export const useAgentModels = create<Record<string, AgentModelChoice[]>>(() => ({}));

export function rememberAgentModels(providers: AgentProviderInfo[]): void {
  useAgentModels.setState(Object.fromEntries(providers.filter((item) => item.models?.length).map((item) => [item.id, item.models!])));
}

/** The harness a view starts with until one is chosen: the first installed. */
export function defaultHarness(providers: AgentProviderInfo[]): string | undefined {
  return (providers.find((provider) => provider.available) ?? providers[0])?.id;
}

export const useDefaultHarness = create<{ id?: string }>(() => ({}));

export function rememberDefaultHarness(providers: AgentProviderInfo[]): void {
  useDefaultHarness.setState({ id: defaultHarness(providers) });
}

/**
 * The model and effort a new conversation launches with: the saved choice when the CLI still offers it, otherwise
 * null (nothing chosen).
 */
export function modelSettings(providerId: string, saved?: AgentModelSettings): AgentModelSettings | null {
  if (!saved) return null;
  const model = useAgentModels.getState()[providerId]?.find((choice) => choice.id === saved.model);
  if (!model) return null;
  const effort = saved.effort && model.efforts.includes(saved.effort) ? saved.effort : model.efforts.includes("medium") ? "medium" : model.efforts[0];
  return effort ? { model: model.id, effort } : { model: model.id };
}

/** A new conversation has to name its model whenever the harness offers any. */
export function needsModelChoice(providerId: string, saved?: AgentModelSettings): boolean {
  return Boolean(useAgentModels.getState()[providerId]?.length) && !modelSettings(providerId, saved);
}

export function modelLabel(providerId: string, settings: AgentModelSettings | null): string {
  if (!settings) return "the CLI's default model";
  const model = useAgentModels.getState()[providerId]?.find((choice) => choice.id === settings.model);
  return [model?.label ?? settings.model, settings.effort].filter(Boolean).join(" ");
}
