import { validateModelSettings, type AgentModelSettings } from "../../shared/agent-models";
import type { AgentProviderAdapter, AgentSubmission, ScreenObservation } from "../agent-provider";
import type { AgentLaunchProfile } from "../agent-launch-profiles";
import { claudeMode, detectCliScreen, pasteChunks } from "./cli-screen";
import type { AgentPromptRequest } from "../../shared/models";

export class ClaudeAgentProvider implements AgentProviderAdapter {
  readonly id = "claude.cli";
  readonly label = "Claude Code";
  readonly executable = process.env.WORKBENCH_CLAUDE_PATH ?? "claude";
  readonly interrupt = "\u001b";
  args(resume: boolean) { return resume ? ["--resume"] : []; }
  modelArgs(settings: AgentModelSettings) {
    validateModelSettings(this.id, settings);
    return ["--model", settings.model, "--effort", settings.effort];
  }
  // `--allowedTools` takes every following argument, so it comes last.
  profileArgs(profile: AgentLaunchProfile) {
    return [...(profile.allowWritesInCwd ? ["--permission-mode", "acceptEdits"] : []),
      ...(profile.allowCommands.length ? ["--allowedTools", ...profile.allowCommands.map((command) => `Bash(${command} *)`)] : [])];
  }
  detect = detectCliScreen("claude");
  readonly capabilities = { planning: true };
  // Shift+Tab cycles the modes (auto → manual → accept edits → plan → ...). `/plan` plus a paste can lose what follows.
  readonly enterPlan = { cycle: "\x1b[Z" };
  readonly leavePlan = { cycle: "\x1b[Z" };
  mode = (screen: ScreenObservation) => { const mode = claudeMode(screen); return mode === "plan mode on" ? "plan" : mode; };
  submit = (request: AgentPromptRequest): AgentSubmission => ({ paste: pasteChunks(request.prompt) });
}
