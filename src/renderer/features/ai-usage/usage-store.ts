import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { create } from "zustand";
import type { UsageSnapshot } from "../../../shared/ai-usage";
import type { AgentProviderInfo } from "../../../shared/models";
import { services } from "../../core/services";
import { useWorkbenchStore } from "../../state/workbench-store";

export const FEATURE_ID = "ai-usage";

const settingsSchema = z.object({
  enabled: z.boolean().catch(true),
  /** Agents left out; every other installed agent is read. */
  hiddenProviders: z.array(z.string()).catch([]),
  display: z.enum(["detailed", "compact"]).catch("detailed"),
});
export type AiUsageSettings = z.infer<typeof settingsSchema>;
const defaults: AiUsageSettings = { enabled: true, hiddenProviders: [], display: "detailed" };

export function useAiUsageSettings(): [AiUsageSettings, (patch: Partial<AiUsageSettings>) => void] {
  const stored = useWorkbenchStore((state) => state.featureSettings?.[FEATURE_ID]);
  const settings = useMemo(() => { const parsed = settingsSchema.safeParse(stored ?? defaults); return parsed.success ? parsed.data : defaults; }, [stored]);
  const update = (patch: Partial<AiUsageSettings>) => useWorkbenchStore.getState().setFeatureSettings(FEATURE_ID, { ...settings, ...patch });
  return [settings, update];
}

/** Installed agent CLIs, kept current as installs change. */
export function useInstalledAgents(): AgentProviderInfo[] {
  const [agents, setAgents] = useState<AgentProviderInfo[]>([]);
  useEffect(() => {
    let active = true;
    const keep = (providers: AgentProviderInfo[]) => { if (active) setAgents(providers.filter((provider) => provider.available && services.sessions.get(provider.id)?.kind === "agent")); };
    window.workbench.agent.providers().then(keep).catch(() => undefined);
    const off = window.workbench.agent.onProvidersChanged(keep);
    return () => { active = false; off(); };
  }, []);
  return agents;
}

export const useAiUsage = create<{ snapshot?: UsageSnapshot }>(() => ({}));

let listening = false;
function listen(): void {
  if (listening) return;
  listening = true;
  window.workbench.aiUsage.onChanged((snapshot) => useAiUsage.setState({ snapshot }));
}

/** Tells the main process which agents to read, once saved settings are loaded. Off reads nothing at all. */
export function useAiUsageConfiguration(): AiUsageSettings {
  const [settings] = useAiUsageSettings();
  const hydrated = useWorkbenchStore((state) => state.isHydrated);
  const agents = useInstalledAgents();
  const ids = settings.enabled ? agents.map((agent) => agent.id).filter((id) => !settings.hiddenProviders.includes(id)) : [];
  const key = ids.join("\n");
  useEffect(() => {
    if (!hydrated) return;
    listen();
    void window.workbench.aiUsage.configure(key ? key.split("\n") : [])
      .then(() => window.workbench.aiUsage.snapshot())
      .then((snapshot) => useAiUsage.setState({ snapshot }))
      .catch(() => undefined);
  }, [hydrated, key]);
  return settings;
}

export function refreshAiUsage(): Promise<void> {
  return window.workbench.aiUsage.refresh().then((snapshot) => useAiUsage.setState({ snapshot }), () => undefined);
}

/** The current time, ticking every `everyMs` while `enabled`, so countdowns stay right. */
export function useNow(enabled: boolean, everyMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [enabled, everyMs]);
  return now;
}

/** "4h 30m", "6d 23h", "12m". */
export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 1) return "<1m";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}

export function formatAgo(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}

export function formatMoney(value: number, currency: string): string {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value); }
  catch { return `${value.toFixed(2)} ${currency}`; }
}

export const formatPercent = (value: number) => `${Math.round(value)}%`;
