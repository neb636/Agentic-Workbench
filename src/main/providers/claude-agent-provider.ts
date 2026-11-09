import type { AgentProviderAdapter, AgentSubmission, ScreenObservation } from "../agent-provider";
import { claudeMode, detectCliScreen, pasteChunks } from "./cli-screen";
import type { AgentModelChoice, AgentModelSettings, AgentPromptRequest, AgentResume } from "../../shared/models";

const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

export class ClaudeAgentProvider implements AgentProviderAdapter {
  readonly id = "claude.cli";
  readonly label = "Claude Code";
  readonly executable = process.env.WORKBENCH_CLAUDE_PATH ?? "claude";
  readonly interrupt = "\u001b";
  // Claude Code's model aliases follow its newest model of each family.
  readonly models: AgentModelChoice[] = ["opus", "sonnet", "haiku"].map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1), efforts: EFFORTS }));
  args(resume?: AgentResume) {
    if (resume?.kind === "id") return ["--resume", resume.id];
    if (resume?.kind === "latest") return ["--continue"];
    return resume ? ["--resume"] : [];
  }
  conversationArgs(id: string) { return ["--session-id", id]; }
  readFolderArgs(folder: string) { return ["--add-dir", folder]; }
  modelArgs(settings: AgentModelSettings) { return ["--model", settings.model, "--effort", settings.effort]; }
  // --safe-mode leaves the user's hooks, MCP servers and instructions out. Not --bare: it skips the keychain login.
  readonly oneShot = {
    args: () => ["-p", "--safe-mode", "--tools", "", "--no-session-persistence"],
    quickTaskModel: { model: "haiku", effort: "medium" },
  };
  detect = detectCliScreen("claude");
  readonly capabilities = { planning: true };
  // Shift+Tab cycles the modes (default → accept edits → plan → ...). `/plan` plus a paste can lose what follows.
  readonly enterPlan = { cycle: "\x1b[Z" };
  readonly leavePlan = { cycle: "\x1b[Z" };
  mode = (screen: ScreenObservation) => { const mode = claudeMode(screen); return mode === "plan mode on" ? "plan" : mode; };
  isUnsafeMode = (mode: string) => /bypass/i.test(mode);
  submit = (request: AgentPromptRequest): AgentSubmission => ({ paste: pasteChunks(request.prompt) });
}
