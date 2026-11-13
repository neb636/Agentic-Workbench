import type { Workspace } from "./models";

/** The id of the built-in Files workspace: single files opened from outside every workspace (see Workspace.kind). */
export const FILES_WORKSPACE_ID = "files";

export function isFilesWorkspace(workspace: Pick<Workspace, "kind">): boolean {
  return workspace.kind === "files";
}
