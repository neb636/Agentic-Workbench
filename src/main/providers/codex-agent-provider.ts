import { validateModelSettings, type AgentModelSettings } from "../../shared/agent-models";
import type { AgentProviderAdapter, AgentSubmission, ScreenObservation } from "../agent-provider";
import { codexPlanMode, detectCliScreen, pasteChunks } from "./cli-screen";
import type { AgentPromptRequest } from "../../shared/models";

export class CodexAgentProvider implements AgentProviderAdapter {
  readonly id = "codex.cli";
  readonly label = "Codex";
  readonly executable = process.env.WORKBENCH_CODEX_PATH ?? "codex";
  readonly interrupt = "\u001b";
  args(resume: boolean) { return resume ? ["resume"] : []; }
  modelArgs(settings: AgentModelSettings) {
    validateModelSettings(this.id, settings);
    // Plan mode has its own effort setting; without it, switching to Plan changes the effort she chose.
    return ["--model", settings.model, "-c", `model_reasoning_effort="${settings.effort}"`, "-c", `plan_mode_reasoning_effort="${settings.effort}"`];
  }
  detect = detectCliScreen("codex");
  // Codex draws its composer before trust and startup checks, which may then replace it.
  readonly startupSettleMs = 1000;
  readonly capabilities = { planning: true };
  // `/plan` takes no prompt: it is its own command, confirmed with Enter, then the prompt goes as a normal message.
  readonly enterPlan = { command: "/plan" };
  readonly leavePlan = { cycle: "\x1b[Z" };
  mode = (screen: ScreenObservation) => codexPlanMode(screen) ? "plan" : "default";
  commandTyped = (screen: ScreenObservation, command: string) => new RegExp(`^\\s*›\\s${command.replace("/", "\\/")}\\s*$`).test(screen.cursorLine);
  submit = (request: AgentPromptRequest): AgentSubmission => ({ paste: pasteChunks(request.prompt) });
}
