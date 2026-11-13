// Before-send guards: the one point where a feature may refuse or question a prompt before it reaches an agent CLI.
// A guard pairs a detector (a small pure function) with what to do when it matches.

/** What a guard sees: the person's draft, and the full prompt with every menu and attachment contribution. */
export interface SendInput {
  draft: string;
  composed: string;
  workspaceId: string;
  viewId: string;
  providerId?: string;
}

/** A detector returns why the prompt matched, or undefined when it didn't. */
export type Detector = (input: SendInput) => string | undefined;

export interface GuardResult {
  guardId: string;
  /** `block` refuses the send; `warn` asks the person first. */
  severity: "block" | "warn";
  message: string;
}

export interface SendGuard {
  id: string;
  order?: number;
  check: (input: SendInput) => GuardResult | undefined;
}

export const guard = (id: string, detector: Detector, options: { onMatch: "block" | "warn"; order?: number }): SendGuard => ({
  id,
  order: options.order,
  check: (input) => {
    const message = detector(input);
    return message ? { guardId: id, severity: options.onMatch, message } : undefined;
  },
});

/** The composed prompt is longer than `max` characters. */
export const maxLength = (max: number): Detector => ({ composed }) =>
  composed.length > max ? `The composed prompt exceeds ${max.toLocaleString("en-US")} characters. Shorten the prompt or remove attachments.` : undefined;

/** `expression` matches the draft (or the composed prompt with `in: "composed"`). */
export const pattern = (expression: RegExp, message: string, options: { in?: "draft" | "composed" } = {}): Detector => (input) =>
  expression.test(options.in === "composed" ? input.composed : input.draft) ? message : undefined;

/** The draft is a CLI's own slash or shell command, which belongs in its terminal. */
export const nativeCommand = (): Detector => pattern(/^\s*[/!]/, "Use native commands directly in the terminal.");

const SECRET_PATTERNS: [string, RegExp][] = [
  ["a private key", /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/],
  ["an AWS access key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["a GitHub token", /\bgh[pousr]_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{60,}\b/],
  ["an Anthropic API key", /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ["an OpenAI API key", /\bsk-(?:proj-)?[A-Za-z0-9]{32,}\b/],
  ["a Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
];

/** The composed prompt seems to contain a credential. A small, conservative set: a hint, not a scanner. */
export const secrets = (): Detector => ({ composed }) => {
  const found = SECRET_PATTERNS.filter(([, expression]) => expression.test(composed)).map(([name]) => name);
  return found.length ? `The prompt seems to contain ${found.join(" and ")}. Agents may log or repeat what they are sent.` : undefined;
};
