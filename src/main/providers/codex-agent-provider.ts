import type { AgentProviderAdapter, AgentSubmission, ScreenObservation } from "../agent-provider";
import { codexPlanMode, detectCliScreen, pasteChunks } from "./cli-screen";
import type { AgentModelChoice, AgentModelSettings, AgentPromptRequest } from "../../shared/models";

const EFFORTS = ["low", "medium", "high", "xhigh", "max", "ultra"];

export class CodexAgentProvider implements AgentProviderAdapter {
  readonly id = "codex.cli";
  readonly label = "Codex";
  readonly executable = process.env.WORKBENCH_CODEX_PATH ?? "codex";
  readonly interrupt = "\u001b";
  // Model names change with Codex releases; "CLI default" in the composer always works.
  readonly models: AgentModelChoice[] = ["gpt-6.1-sol", "gpt-6-astra", "gpt-6.1-terra", "gpt-6-sol", "gpt-6-luna"].map((id) => ({
    id, label: id, efforts: id === "gpt-6-luna" ? EFFORTS.slice(0, -1) : EFFORTS,
  }));
  args(resume: boolean) { return resume ? ["resume"] : []; }
  modelArgs(settings: AgentModelSettings) {
    // Plan mode has its own effort setting; without it, switching to Plan changes the chosen effort.
    return ["--model", settings.model, "-c", `model_reasoning_effort="${settings.effort}"`, "-c", `plan_mode_reasoning_effort="${settings.effort}"`];
  }
  detect = detectCliScreen("codex");
  // Codex draws its composer before trust and startup checks, which may then replace it.
  readonly startupSettleMs = 1000;
  // Codex reports state=idle, working, or done over OSC 7501; only "working" means busy.
  readonly reportedState = { osc: 7501, parse: (data: string) => {
    const state = /(?:^|;)state=([a-z-]+)/.exec(data)?.[1];
    return state ? (state === "working" ? "working" as const : "idle" as const) : undefined;
  } };
  // A braille spinner leads the window title while Codex starts up.
  startupBusy = (title: string) => /^[⠀-⣿]/.test(title.trim());
  readonly capabilities = { planning: true };
  // `/plan` takes no prompt: it is its own command, confirmed with Enter, then the prompt goes as a normal message.
  readonly enterPlan = { command: "/plan" };
  readonly leavePlan = { cycle: "\x1b[Z" };
  mode = (screen: ScreenObservation) => codexPlanMode(screen) ? "plan" : "default";
  commandTyped = (screen: ScreenObservation, command: string) => new RegExp(`^\\s*›\\s${command.replace("/", "\\/")}\\s*$`).test(screen.cursorLine);
  submit = (request: AgentPromptRequest): AgentSubmission => ({ paste: pasteChunks(request.prompt) });
}
