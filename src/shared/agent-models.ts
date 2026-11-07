export interface AgentModelSettings { model: string; effort: string; }
const codexEfforts = ["low", "medium", "high", "xhigh", "max", "ultra"];
/** Native CLI choices, kept separate per provider in each agent tab. */
export const AGENT_MODELS: Record<string, { id: string; label: string; efforts: string[] }[]> = {
  "codex.cli": ["gpt-6.1-sol", "gpt-6-astra", "gpt-6.1-terra", "gpt-6-sol", "gpt-6-luna"].map(id => ({
    id, label: id, efforts: id === "gpt-6-luna" ? codexEfforts.slice(0, -1) : codexEfforts,
  })),
  "claude.cli": ["opus", "sonnet", "haiku"].map(id => ({
    id, label: id[0].toUpperCase() + id.slice(1), efforts: ["low", "medium", "high", "xhigh", "max"],
  })),
};
export function modelSettings(providerId: string, saved?: AgentModelSettings): AgentModelSettings | undefined {
  const choices = AGENT_MODELS[providerId];
  if (!choices) return undefined;
  const model = choices.find(m => m.id === saved?.model) ?? choices[0];
  return { model: model.id, effort: model.efforts.includes(saved?.effort ?? "") ? saved!.effort : "medium" };
}
export function validateModelSettings(providerId: string, settings: AgentModelSettings): void {
  if (!AGENT_MODELS[providerId]?.some(m => m.id === settings.model && m.efforts.includes(settings.effort))) {
    throw new Error("Unsupported model or effort for this provider.");
  }
}
