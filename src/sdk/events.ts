// Things that happened in the workbench. Events are notifications: a handler can react, but nothing it does can stop or
// change what already happened. The few places that may refuse something are explicit (see `beforeSend`).
import type { ViewStatus } from "./contributions";

export interface WorkbenchEvents {
  "workspace.opened": { workspaceId: string; root: string };
  "workspace.closed": { workspaceId: string; root: string };
  "view.opened": { workspaceId: string; viewId: string; type: string };
  "view.closed": { workspaceId: string; viewId: string; type: string };
  /** The view shown in its workspace changed. */
  "view.activated": { workspaceId: string; viewId: string; type: string };
  /** A view's live status changed (an agent started working, finished, needs attention). Undefined: no live status. */
  "view.status": { viewId: string; status: ViewStatus | undefined };
  /** A prompt reached an agent CLI. `prompt` is what was sent, with every contribution in place. */
  "prompt.sent": { workspaceId: string; viewId: string; providerId?: string; prompt: string };
  "extension.activated": { extensionId: string; workspaceId?: string };
  "extension.failed": { extensionId: string; workspaceId?: string; error: string };
}

export type WorkbenchEventName = keyof WorkbenchEvents;
export type WorkbenchEventHandler<K extends WorkbenchEventName> = (event: WorkbenchEvents[K]) => void;
