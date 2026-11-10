import type { AgentDetection, ScreenObservation } from "../agent-provider";

/** Bracketed paste is sent in pieces of at most this many UTF-8 bytes, so a large prompt never floods the CLI's reader. */
export const PASTE_CHUNK_BYTES = 2048;

function validatePrompt(prompt: string): string {
  if (/^\s*[/!]/.test(prompt)) throw new Error("Use native commands directly in the terminal.");
  const text = prompt.replace(/\r\n/g, "\n");
  // Terminal controls must never escape bracketed paste into native commands.
  // eslint-disable-next-line no-control-regex
  if (!text.trim() || /[\x00-\x08\x0b-\x1f\x7f]/.test(text)) throw new Error("Prompt contains unsupported terminal control characters.");
  return text;
}

/** The paste as separate writes: the opening marker, the body in ≤2 KiB pieces split on whole characters, the closing marker. */
export function pasteChunks(prompt: string): string[] {
  const text = validatePrompt(prompt);
  const chunks: string[] = [];
  let current = "", bytes = 0;
  for (const char of text) {
    const size = Buffer.byteLength(char);
    if (bytes + size > PASTE_CHUNK_BYTES && current) { chunks.push(current); current = ""; bytes = 0; }
    current += char; bytes += size;
  }
  if (current) chunks.push(current);
  return ["\x1b[200~", ...chunks, "\x1b[201~"];
}

export function pastePrompt(prompt: string): string { return pasteChunks(prompt).join(""); }

/**
 * Input that is the terminal talking, not the person typing: mouse reports (Codex tracks every pointer move),
 * focus changes, and replies to the CLI's own queries (cursor position, device attributes, colours).
 */
export function isProtocolInput(data: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /^(?:\x1b\[<\d+;\d+;\d+[Mm]|\x1b\[M[\s\S]{3}|\x1b\[[IO]|\x1b\[\d+;\d+R|\x1b\[\?[\d;]*[cu]|\x1b\[>[\d;]*c|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\))+$/.test(data);
}

/** The lines drawn under the prompt: where both CLIs show their mode. */
export function footer(screen: ScreenObservation): string {
  return screen.lines.slice(screen.cursorY + 1).join("\n");
}

// Codex: "Plan mode (⇧tab to cycle)" in the footer. The slash picker's "/plan  switch to Plan mode" is a hint, not the mode.
export function codexPlanMode(screen: ScreenObservation): boolean {
  return footer(screen).split("\n").some((line) => /\bPlan mode\b/.test(line) && !/switch to Plan mode/i.test(line));
}
// Claude Code: "⏸ plan mode on (shift+tab to cycle)"; its other modes read "auto mode on", "accept edits on", ...
export function claudeMode(screen: ScreenObservation): string {
  return footer(screen).match(/[⏵⏸▶►]+\s*([a-z][a-z ]*? on)\b/i)?.[1].toLowerCase() ?? "default";
}

export function detectCliScreen(kind: "codex" | "claude") {
  return (screen: ScreenObservation): AgentDetection => {
    const lines = [...screen.lines];
    while (lines.length && !lines.at(-1)?.trim()) lines.pop();
    const bottom = lines.slice(-12).join("\n");
    let queuedPrompt = false;
    const result = (activity: AgentDetection["activity"], canSubmit: boolean, rule: string, reason: string, inputState: AgentDetection["inputState"] = "unavailable"): AgentDetection =>
      ({ activity, canSubmit, inputState, rule: `${kind}.${rule}`, reason, ...(queuedPrompt ? { queuedPrompt } : {}) });
    // Codex also reports it itself (see its adapter's reportedState), which survives a redesign of its spinner.
    const working = kind === "codex"
      ? screen.reportedState === "working" || /esc to (?:interrupt|cancel)|• (?:Working|Thinking)|(?:Working|Thinking)\s*[.…]|Waiting for startup/i.test(bottom)
      : /esc to (?:interrupt|cancel)|(?:^|\n)\s*[✻✽✶✳✢·] [^\n]+…/i.test(bottom);
    const prompt = kind === "codex" ? /^\s*›\s?(.*)$/ : /^\s*[❯>]\s?(.*)$/;
    let match = screen.cursorLine.match(prompt);
    let multiline = false;
    if (!match) {
      for (let row = screen.cursorY - 1; row >= Math.max(0, screen.cursorY - 12); row--) {
        const line = screen.lines[row];
        const candidate = line.match(prompt);
        if (candidate) { match = candidate; multiline = true; break; }
        if (line.trim() && !/^\s{2}/.test(line)) break;
      }
    }
    const atStart = screen.cursorX <= (screen.cursorLine.indexOf(kind === "codex" ? "›" : "❯") + 2);
    // Codex draws its placeholder dim and typed text never is, so the style alone tells them apart. Claude's placeholder
    // is plain text, so a typed draft that happens to start with "Try" stays a draft. While Claude holds a prompt sent
    // mid-turn, its empty input reads "Press up to edit queued messages" and the held prompt shows "ctrl+enter to send
    // now" until the CLI takes it. (Codex steers the running turn with Enter instead, so it shows no queue.)
    const claudeQueue = kind === "claude" && !screen.inputWasEdited && match?.[1].trim() === "Press up to edit queued messages";
    const placeholder = match && atStart && (kind === "codex"
      ? screen.cursorCellDim && /^(Ask Codex|Write tests|Explain this|Implement|Find and fix|Improve documentation|Summarize recent|Run \/review)/.test(match[1])
      : !screen.inputWasEdited && (/^Try\s+["“].+["”]$/.test(match[1]) || claudeQueue));
    queuedPrompt = kind === "claude" && (Boolean(placeholder && claudeQueue) || /(?:^|\n)\s*ctrl\+enter to send now\s*(?:\n|$)/.test(bottom));
    const empty = Boolean(match && !multiline && (!match[1].trim() || placeholder));
    const inputState = !match || !screen.bracketedPaste ? "unavailable" : empty ? "empty" : "draft";
    // Transcript text can mention "sign in" or "select an option"; a decision UI replaces the empty input prompt.
    // Codex's update picker ("1. Update now · 2. Skip · enter continue · esc skip") is a decision too.
    if (!empty && /trust (?:this|the)|allow once|allow always|yes, (?:proceed|allow)|do you want to (?:proceed|allow)|would you like to (?:run|proceed)|enter to confirm|enter continue|esc skip|skip until next version|select an option|sign in|log in|choose.*account/i.test(bottom)) {
      return result("waiting-for-input", false, "decision", "Answer the question in the terminal.");
    }
    // A held prompt means a turn is running, even in a frame without a spinner (Claude draws none while streaming text).
    if (working || queuedPrompt) return result("working", inputState === "empty", "working", empty ? "Submit using the CLI’s native queue or steering." : "Clear the native draft or use the terminal input.", inputState);
    if (match) return result("ready", inputState === "empty", empty ? "prompt" : "native-draft", !screen.bracketedPaste ? "Use the terminal; paste mode is not available." : empty ? "Ready for a prompt." : "A draft is already in the terminal. Send or clear it there first.", inputState);
    return result("unknown", false, "unmatched", "Use the terminal until its prompt is recognized.");
  };
}
