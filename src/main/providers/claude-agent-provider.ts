import type { AgentModelListing, AgentProviderAdapter, AgentSubmission, ScreenObservation } from "../agent-provider";
import { claudeMode, detectCliScreen, pasteChunks } from "./cli-screen";
import type { AgentModelChoice, AgentModelSettings, AgentPromptRequest, AgentResume } from "../../shared/models";

const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

interface ClaudeModel { value: string; displayName?: string; supportedEffortLevels?: string[] }

function parseClaudeModels(stdout: string): AgentModelChoice[] {
  const line = stdout.split("\n").find((item) => item.includes('"control_response"'));
  const models = (line ? JSON.parse(line) : undefined)?.response?.response?.models as ClaudeModel[] | undefined;
  // "default" means whatever the CLI is configured to use; a session always names its model.
  return (models ?? []).filter((model) => model.value !== "default")
    .map((model) => ({ id: model.value, label: model.displayName ?? model.value, efforts: model.supportedEffortLevels ?? [] }));
}

export class ClaudeAgentProvider implements AgentProviderAdapter {
  readonly id = "claude.cli";
  readonly label = "Claude Code";
  readonly executable = process.env.WORKBENCH_CLAUDE_PATH ?? "claude";
  readonly interrupt = "\u001b";
  // Claude Code's model aliases follow its newest model of each family.
  readonly models: AgentModelChoice[] = ["opus", "fable", "sonnet", "haiku"].map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1), efforts: EFFORTS }));
  // The handshake that opens a headless session lists the models and starts no conversation. Setting sources are
  // cleared so a background read never runs the person's hooks; --bare would also narrow the list, as it skips sign-in.
  readonly listModels: AgentModelListing = {
    args: ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--no-session-persistence", "--strict-mcp-config", "--setting-sources", ""],
    input: `${JSON.stringify({ type: "control_request", request_id: "workbench-models", request: { subtype: "initialize" } })}\n`,
    ready: (stdout) => /"control_response".*\n/.test(stdout),
    parse: parseClaudeModels,
  };
  args(resume?: AgentResume) {
    if (resume?.kind === "id") return ["--resume", resume.id];
    if (resume?.kind === "latest") return ["--continue"];
    return resume ? ["--resume"] : [];
  }
  conversationArgs(id: string) { return ["--session-id", id]; }
  readFolderArgs(folder: string) { return ["--add-dir", folder]; }
  modelArgs(settings: AgentModelSettings) { return ["--model", settings.model, ...(settings.effort ? ["--effort", settings.effort] : [])]; }
  detect = detectCliScreen("claude");
  readonly capabilities = { planning: true };
  // Shift+Tab cycles the modes (default → accept edits → plan → ...). `/plan` plus a paste can lose what follows.
  readonly enterPlan = { cycle: "\x1b[Z" };
  readonly leavePlan = { cycle: "\x1b[Z" };
  mode = (screen: ScreenObservation) => { const mode = claudeMode(screen); return mode === "plan mode on" ? "plan" : mode; };
  isUnsafeMode = (mode: string) => /bypass/i.test(mode);
  submit = (request: AgentPromptRequest): AgentSubmission => ({ paste: pasteChunks(request.prompt) });
}
