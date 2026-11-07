import type { AgentModelSettings } from "../shared/agent-models";
import type { AgentPromptRequest, AgentSessionStatus } from "../shared/models";
import type { AgentLaunchProfile } from "./agent-launch-profiles";

export interface ScreenObservation {
  lines: string[];
  cursorLine: string;
  cursorX: number;
  cursorY: number;
  cursorCellDim: boolean;
  inputWasEdited: boolean;
  bracketedPaste: boolean;
  /** What the CLI last said about itself (Codex: OSC 7501 state=idle|working), if it says anything. */
  reportedState?: "idle" | "working";
}
export type AgentDetection = Pick<AgentSessionStatus, "activity" | "canSubmit" | "inputState" | "reason" | "rule">;

export interface AgentSubmission {
  /** The bracketed paste as separate writes (markers and ≤2 KiB pieces). */
  paste: string[];
}

/**
 * How a CLI changes mode. `command`: type it, let the slash picker settle, press Enter (Codex `/plan`, which takes no
 * prompt). `cycle`: press the key and look at the footer after each press, at most five times (Claude's Shift+Tab).
 */
export type ModeSwitch = { command: string } | { cycle: string };

/** Executable, native UI and key protocol knowledge belongs to an adapter. */
export interface AgentProviderAdapter {
  id: string;
  label: string;
  executable: string;
  args: (resume: boolean) => string[];
  /** Model and effort for a new conversation, as launch arguments (a resumed one keeps what it was saved with). */
  modelArgs?: (settings: AgentModelSettings) => string[];
  /** Native arguments granting a launch profile's permissions; adapters without it refuse profiles. */
  profileArgs?: (profile: AgentLaunchProfile) => string[];
  detect: (screen: ScreenObservation) => AgentDetection;
  capabilities?: { planning: boolean };
  /** Quiet time a first input prompt must hold before it accepts a submission; some CLIs draw it before startup dialogs. */
  startupSettleMs?: number;
  submit: (request: AgentPromptRequest) => AgentSubmission;
  /** The mode the footer shows: "plan" or the CLI's name for another mode ("default" when it shows none). */
  mode?: (screen: ScreenObservation) => string;
  enterPlan?: ModeSwitch;
  leavePlan?: ModeSwitch;
  /** Recognizes the typed mode command in the editor before Enter selects it. */
  commandTyped?: (screen: ScreenObservation, command: string) => boolean;
  interrupt: string;
}
