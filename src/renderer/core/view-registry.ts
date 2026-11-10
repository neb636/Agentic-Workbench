import type { ComponentType } from "react";
import type { WorkbenchView, Workspace } from "../../shared/models";
import { Registry } from "./registry";
import type { ViewStatus } from "./view-status";
import type { DestructiveConfirmation } from "../ui/confirm";

export interface ViewComponentProps {
  view: WorkbenchView;
  workspace: Workspace;
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

export class ViewRegistry extends Registry<ViewDefinition> {}
