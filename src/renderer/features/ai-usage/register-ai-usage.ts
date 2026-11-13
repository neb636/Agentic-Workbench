import { defineExtension } from "@dimsum/sdk";
import { AiUsageSettings } from "./AiUsageSettings";
import { UsageStatus } from "./UsageStatus";
import "./ai-usage.css";

/**
 * AI usage: each agent CLI's plan usage in the status bar, with a setting to turn it off. Self-contained: removing
 * this folder, its entry in the built-in extensions and the main process's `src/main/ai-usage/` removes the feature.
 */
export const aiUsage = defineExtension({
  name: "AI usage",
  description: "Each agent CLI's plan usage in the status bar.",
  activate(ctx) {
    ctx.widgets.register({ id: "ai-usage", slot: "statusbar.end", order: 15, component: UsageStatus });
    ctx.widgets.register({ id: "ai-usage-settings", slot: "settings.general", order: 10, component: AiUsageSettings });
  },
});
