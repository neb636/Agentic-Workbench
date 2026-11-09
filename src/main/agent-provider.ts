import type { AgentModelChoice, AgentModelSettings, AgentPromptRequest, AgentResume, AgentSessionStatus } from "../shared/models";

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

/** How to ask a CLI which models it offers, without starting a conversation. */
export interface AgentModelListing {
  args: string[];
  /** Written to the CLI's stdin, which then stays open. */
  input?: string;
  /** For a CLI that keeps running after it answers: true once the output is complete, and the CLI is stopped. */
  ready?: (stdout: string) => boolean;
  parse: (stdout: string) => AgentModelChoice[];
}

/** Executable, native UI and key protocol knowledge belongs to an adapter. */
export interface AgentProviderAdapter {
  id: string;
  label: string;
  executable: string;
  args: (resume?: AgentResume) => string[];
  /** Launch arguments naming a new conversation, for CLIs that accept an id: it can then be resumed exactly. */
  conversationArgs?: (id: string) => string[];
  /** Launch arguments that let a CLI which asks before reading outside where it runs read this folder (prompt attachments). */
  readFolderArgs?: (folder: string) => string[];
  /** Models offered for new conversations until the CLI's own list has been read, or when it can't be. */
  models?: AgentModelChoice[];
  listModels?: AgentModelListing;
  /** Model and effort as launch arguments; only called with a model the catalogue offers. */
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
