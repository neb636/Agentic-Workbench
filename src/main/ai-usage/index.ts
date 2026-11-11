import { app, BrowserWindow } from "electron";
import path from "node:path";
import { AI_USAGE_IPC, aiUsageConfigureSchema } from "../../shared/ai-usage";
import type { AgentProviderAdapter } from "../agent-provider";
import { handle } from "../ipc";
import { AiUsageService } from "./ai-usage-service";
import { ClaudeUsageSource } from "./sources/claude-usage-source";
import { CodexUsageSource } from "./sources/codex-usage-source";
import type { UsageSource } from "./usage-source";

/**
 * AI usage: each agent CLI's plan usage, from the sign-in the CLI already has. Self-contained: removing this folder,
 * its renderer feature and the lines in `src/main/index.ts` that call into it removes the feature.
 *
 * Reading usage is not AI use: it sends no prompt and spends nothing, so it doesn't go through InternalAiService.
 */
export function createAiUsage(providers: AgentProviderAdapter[]): AiUsageService {
  const folder = () => path.join(app.getPath("userData"), "ai-usage");
  // The sources this build knows, for whichever of their providers are registered.
  const sources = providers.flatMap((provider): UsageSource[] => {
    if (provider.id === "claude.cli") return [new ClaudeUsageSource(provider.id, provider.label, folder)];
    if (provider.id === "codex.cli") return [new CodexUsageSource(provider.id, provider.label, provider.executable)];
    return [];
  });
  return new AiUsageService(sources, () => BrowserWindow.getFocusedWindow() !== null, (snapshot) => {
    for (const window of BrowserWindow.getAllWindows()) if (!window.webContents.isDestroyed()) window.webContents.send(AI_USAGE_IPC.changed, snapshot);
  });
}

export function registerAiUsage(service: AiUsageService): void {
  handle(AI_USAGE_IPC.snapshot, () => service.snapshot());
  handle(AI_USAGE_IPC.refresh, () => service.refresh());
  handle(AI_USAGE_IPC.configure, (_event, input) => service.configure(aiUsageConfigureSchema.parse(input).providers));
  app.on("browser-window-focus", () => service.focused());
}
