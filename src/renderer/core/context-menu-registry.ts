import type { Workspace, WorkbenchView } from "../../shared/models";
import type { FileLocation } from "../../shared/file-operations";
import type { ContextAction } from "../ui/ContextMenu";
import { Registry } from "./registry";
export type MenuContext = { kind: "workspace"; workspace: Workspace } | { kind: "view"; workspace: Workspace; view: WorkbenchView } | { kind: "file"; workspace: Workspace; location: FileLocation; directory: boolean; available?: boolean; line?: number }
  | { kind: "selection"; workspace: Workspace; selection: TextSelection };
/** Text selected in a file: `fromLine`–`toLine` are 1-based and inclusive. */
export interface TextSelection { location: FileLocation; text: string; fromLine: number; toLine: number }
export interface MenuContribution { id: string; kind: MenuContext["kind"]; items: (context: MenuContext) => ContextAction[] }
export class ContextMenuRegistry extends Registry<MenuContribution> {
  forTarget(context: MenuContext): ContextAction[] { return this.list().filter((c) => c.kind === context.kind).flatMap((c) => c.items(context)); }
}
