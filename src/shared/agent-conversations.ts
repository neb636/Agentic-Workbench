import type { AgentResume, AgentViewState } from "./models";

/**
 * The conversation a view can reopen. State saved before `conversation` existed can still show one:
 * the title is only taken from a prompt that reached the CLI.
 */
export function savedConversation(state: AgentViewState | undefined): { providerId: string; id?: string } | undefined {
  if (state?.conversation !== undefined) return state.conversation ?? undefined;
  return state?.autoTitle === false && state.cwd && state.providerId ? { providerId: state.providerId } : undefined;
}

/**
 * How to reopen a view's conversation: by id when it has one, else the newest in its folder. When another view's
 * conversation could be that newest one, the CLI's own picker asks rather than risk reopening the wrong one.
 */
export function resumeRequest(state: AgentViewState | undefined, views: AgentViewState[]): AgentResume | undefined {
  const saved = savedConversation(state);
  if (!saved) return undefined;
  if (saved.id) return { kind: "id", id: saved.id };
  const shared = views.some((other) => other !== state && other.cwd === state?.cwd && savedConversation(other)?.providerId === saved.providerId);
  return { kind: shared ? "pick" : "latest" };
}
