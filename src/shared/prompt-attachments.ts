import type { PromptAttachment } from "./models";

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENTS = 10;

/** CLIs take a prompt as terminal text, so a file goes as the path to read it from. */
export function attachmentsPrompt(attachments: PromptAttachment[]): string {
  return ["Attached files (read them from these paths):", ...attachments.map((item) => `- ${item.path}`)].join("\n");
}
