import type { AgentModelListing, AgentProviderAdapter, AgentSubmission, ScreenObservation } from "../agent-provider";
import { codexPlanMode, detectCliScreen, pasteChunks } from "./cli-screen";
import type { AgentModelChoice, AgentModelSettings, AgentPromptRequest, AgentResume } from "../../shared/models";

const EFFORTS = ["low", "medium", "high", "xhigh", "max", "ultra"];

interface CodexModel { slug: string; display_name?: string; visibility?: string; supported_reasoning_levels?: { effort: string }[] }

function parseCodexModels(stdout: string): AgentModelChoice[] {
  const { models } = JSON.parse(stdout) as { models: CodexModel[] };
  return models.filter((model) => model.visibility === "list")
    .map((model) => ({ id: model.slug, label: model.display_name ?? model.slug, efforts: (model.supported_reasoning_levels ?? []).map((level) => level.effort) }));
}

export class CodexAgentProvider implements AgentProviderAdapter {
  readonly id = "codex.cli";
  readonly label = "Codex";
  readonly executable = process.env.WORKBENCH_CODEX_PATH ?? "codex";
  readonly interrupt = "\u001b";
  // Model names change with Codex releases: this list only stands in until `listModels` has answered.
  readonly models: AgentModelChoice[] = ["gpt-6.1-sol", "gpt-6-astra", "gpt-6.1-terra", "gpt-6-sol", "gpt-6-luna"].map((id) => ({
    id, label: id, efforts: id === "gpt-6-luna" ? EFFORTS.slice(0, -1) : EFFORTS,
  }));
  readonly listModels: AgentModelListing = { args: ["debug", "models"], parse: parseCodexModels };
  // Codex can't be given an id for a new conversation; --last looks only at the folder it runs in.
  args(resume?: AgentResume) {
    if (resume?.kind === "id") return ["resume", resume.id];
    if (resume?.kind === "latest") return ["resume", "--last"];
    return resume ? ["resume"] : [];
  }
  modelArgs(settings: AgentModelSettings) {
    // Plan mode has its own effort setting; without it, switching to Plan changes the chosen effort.
    if (!settings.effort) return ["--model", settings.model];
    return ["--model", settings.model, "-c", `model_reasoning_effort="${settings.effort}"`, "-c", `plan_mode_reasoning_effort="${settings.effort}"`];
  }
  // No shell, and none of the user's hooks or MCP servers. Codex has no "latest" alias, so the newest Luna is named here.
  readonly oneShot = {
    args: () => ["exec", "--ephemeral", "--sandbox", "read-only", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules", "--disable", "shell_tool", "--disable", "unified_exec"],
    quickTaskModel: { model: "gpt-6-luna", effort: "medium" },
  };
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
