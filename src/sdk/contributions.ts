// What features and extensions contribute to the workbench. These are contracts only: the app's registries implement
// them, and first-party features use exactly the same shapes as extensions loaded from a workspace.
import type { ComponentType, ReactNode } from "react";
import type { FileLocation } from "../shared/file-operations";
import type { PromptContribution, WorkbenchView, Workspace } from "../shared/models";
import type { PromptOptionDefinition } from "../shared/prompt-options";

export type { FileLocation, PromptContribution, WorkbenchView, Workspace };

// Views ------------------------------------------------------------------------------------------------------------

export interface ViewComponentProps {
  view: WorkbenchView;
  workspace: Workspace;
}

export interface ViewStatus {
  label: string;
  tone: "idle" | "ready" | "working" | "attention" | "error";
  /** Secondary text, such as the session's provider. */
  detail?: string;
  /** Something finished that the user has not looked at yet. */
  unseen?: boolean;
  description?: string;
}

export interface DestructiveConfirmation {
  title: string;
  message: string;
  /** What is lost, shown in the warning callout. */
  warning: ReactNode;
  /** The thing being removed. */
  subject: { icon: ReactNode; name: string; detail?: string; meta?: string };
  confirmLabel: string;
  /** "caution": going ahead loses nothing, it only deserves a second look (a prompt a send guard warned about). */
  tone?: "destructive" | "caution";
}

export interface ViewDefinition {
  id: string;
  label: string;
  description: string;
  /** Given a view when drawn for that open view, so the icon can reflect it; without one it stands for the view type. */
  icon: ComponentType<{ size?: number; view?: WorkbenchView }>;
  component: ComponentType<ViewComponentProps>;
  createState?: () => unknown;
  /** Whether the new-view menus offer this type; views opened by commands set it false. */
  creatable?: boolean;
  /** Title for new views; defaults to the label. */
  defaultTitle?: string;
  /** Views of this type are listed under their workspace in the left sidebar. */
  listInSidebar?: boolean;
  /** The tab's title is in italics (a preview tab, replaced by the next one). */
  isPreview?: (view: WorkbenchView) => boolean;
  /** Extra view actions shared by tabs, sidebar rows, and Active views, after the close group. */
  tabMenu?: (view: WorkbenchView) => { id: string; label: string; run: () => void }[];
  /** The person clicked this view's tab or list row, or the app reopened on it; showing it some other way doesn't count. */
  onActivate?: (view: WorkbenchView) => void;
  /** Status shown when no live status has been published for the view. */
  idleStatus?: (view: WorkbenchView) => ViewStatus | undefined;
  /** Closing this view loses something worth asking about (a running agent, a conversation); undefined closes it without asking. */
  confirmClose?: (view: WorkbenchView) => DestructiveConfirmation | undefined;
}

// Panels and widgets -----------------------------------------------------------------------------------------------

export interface PanelProps {
  workspace: Workspace;
}

/** A side panel shown in the right sidebar and switched from its activity bar. */
export interface PanelDefinition {
  id: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
  order?: number;
  component: ComponentType<PanelProps>;
  /** A small count or mark on the panel's activity button (such as how many files changed); renders nothing when empty. */
  badge?: ComponentType<PanelProps>;
}

/** Slots pass whatever context they have; a workspace row passes only its workspace. */
export interface WidgetProps {
  workspaceId?: string;
  viewId?: string;
}

/**
 * A component placed in a named slot. Slots today: `sidebar.footer`, `sidebar.workspace.meta`, `statusbar.start`,
 * `statusbar.end`, `settings.general`, `agent.composer.toolbar`.
 */
export interface WidgetDefinition {
  id: string;
  slot: string;
  order?: number;
  component: ComponentType<WidgetProps>;
}

// Composer ---------------------------------------------------------------------------------------------------------

export interface PromptMenuContext {
  workspaceId: string;
  viewId: string;
  /** The agent harness the composer sends to, such as `claude.cli`; unknown before one is chosen. */
  providerId?: string;
}

export interface PromptOptionTag {
  label: string;
  icon: ComponentType<{ size?: number }>;
}

/** A composer menu whose options add text before or after the user's prompt. */
export interface PromptMenuDefinition {
  id: string;
  label: string;
  description: string;
  icon: ComponentType<{ size?: number }>;
  order?: number;
  kind: PromptContribution["kind"];
  placement: "prepend" | "append";
  /** Whether options return to their defaults after a successful send; options may override it. */
  resetAfterSend: boolean;
  options: (context: PromptMenuContext) => PromptOptionDefinition[];
  /** Calls `listener` whenever `options` may return something different; returns an unsubscribe. */
  subscribe?: (listener: () => void) => () => void;
  /** A small marker shown beside an option, such as where it comes from. */
  optionTag?: (optionId: string, context: PromptMenuContext) => PromptOptionTag | undefined;
  manage?: { title: string; description: string; component: ComponentType<{ workspaceId: string; close: () => void }> };
}

export interface PromptContributor {
  id: string;
  contributions: (context: { workspaceId: string; viewId: string }) => PromptContribution[];
}

// Context menus ----------------------------------------------------------------------------------------------------

export interface ContextAction {
  id: string; label: string; run: () => void | Promise<unknown>; disabled?: boolean; destructive?: boolean; section?: string; shortcut?: string;
  /** Shown before the label; menus without room for it ignore it. */
  icon?: ReactNode;
  /** A second line under the label. */
  detail?: string;
}

/** Text selected in a file: `fromLine`–`toLine` are 1-based and inclusive. */
export interface TextSelection { location: FileLocation; text: string; fromLine: number; toLine: number }

export type MenuContext =
  | { kind: "workspace"; workspace: Workspace }
  | { kind: "view"; workspace: Workspace; view: WorkbenchView }
  | { kind: "file"; workspace: Workspace; location: FileLocation; directory: boolean; available?: boolean; line?: number }
  | { kind: "selection"; workspace: Workspace; selection: TextSelection };

export interface MenuContribution { id: string; kind: MenuContext["kind"]; items: (context: MenuContext) => ContextAction[] }

// Commands ---------------------------------------------------------------------------------------------------------

export type CommandHandler<TArgs = unknown, TResult = unknown> = (args: TArgs) => TResult | Promise<TResult>;
