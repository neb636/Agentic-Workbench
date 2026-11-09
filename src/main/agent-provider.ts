import type { AgentModelChoice, AgentModelSettings, AgentPromptRequest, AgentSessionStatus } from "../shared/models";

export interface ScreenObservation {
  lines: string[];
  cursorLine: string;
  cursorX: number;
  cursorY: number;
  cursorCellDim: boolean;
  inputWasEdited: boolean;
  bracketedPaste: boolean;
  /** What the CLI last reported about itself through its own escape sequence, if its adapter reads one. */
  reportedState?: "idle" | "working";
}
export type AgentDetection = Pick<AgentSessionStatus, "activity" | "canSubmit" | "inputState" | "reason" | "rule">;

export interface AgentSubmission {
  /** The bracketed paste as separate writes (markers and small pieces of the body). */
  paste: string[];
}

/**
 * How a CLI changes mode. `command`: type it, let the slash picker settle, press Enter. `cycle`: press the key and
 * look at the footer after each press, a few times at most.
 */
export type ModeSwitch = { command: string } | { cycle: string };

/** Executable, native UI and key protocol knowledge belongs to an adapter. */
export interface AgentProviderAdapter {
  id: string;
  label: string;
  executable: string;
  args: (resume: boolean) => string[];
  /** Launch arguments that let a CLI which asks before reading outside where it runs read this folder (prompt attachments). */
  readFolderArgs?: (folder: string) => string[];
  /** Models offered for new conversations. */
  models?: AgentModelChoice[];
  /** Model and effort as launch arguments; only called with a choice from `models`. */
  modelArgs?: (settings: AgentModelSettings) => string[];
  detect: (screen: ScreenObservation) => AgentDetection;
  capabilities?: { planning: boolean };
  /** Quiet time a first input prompt must hold before it accepts a submission; some CLIs draw it before startup dialogs. */
  startupSettleMs?: number;
  /** A private OSC sequence through which the CLI reports whether it is working. */
  reportedState?: { osc: number; parse: (data: string) => "idle" | "working" | undefined };
  /** True while the CLI's window title says it is still starting up. */
  startupBusy?: (title: string) => boolean;
  submit: (request: AgentPromptRequest) => AgentSubmission;
  /** The mode the footer shows: "plan" or the CLI's own name for another mode ("default" when it shows none). */
  mode?: (screen: ScreenObservation) => string;
  enterPlan?: ModeSwitch;
  leavePlan?: ModeSwitch;
  /** Recognizes the typed mode command in the editor before Enter selects it. */
  commandTyped?: (screen: ScreenObservation, command: string) => boolean;
  /** Modes that leaving Plan must never land in by accident (such as skipping permission prompts). */
  isUnsafeMode?: (mode: string) => boolean;
  interrupt: string;
}
