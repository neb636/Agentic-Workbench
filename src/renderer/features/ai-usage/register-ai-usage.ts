import { services } from "../../core/services";
import { AiUsageSettings } from "./AiUsageSettings";
import { UsageStatus } from "./UsageStatus";
import "./ai-usage.css";

/**
 * AI usage: each agent CLI's plan usage in the status bar, with a setting to turn it off. Self-contained: removing
 * this folder, the call to this function and the main process's `src/main/ai-usage/` removes the feature.
 */
export function registerAiUsage(): void {
  services.widgets.register({ id: "ai-usage", slot: "statusbar.end", order: 15, component: UsageStatus });
  services.widgets.register({ id: "ai-usage-settings", slot: "settings.general", order: 10, component: AiUsageSettings });
}
