import type { ComponentType } from "react";
import type { WorkbenchView, Workspace } from "../../shared/models";
import { Registry } from "./registry";
import type { ViewStatus } from "./view-status";

export interface ViewComponentProps {
  view: WorkbenchView;
  workspace: Workspace;
}

export interface ViewDefinition {
  id: string;
  label: string;
  description: string;
  icon: ComponentType<{ size?: number }>;
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
  /** The person clicked this view's tab or list row; showing it some other way doesn't count. */
  onActivate?: (view: WorkbenchView) => void;
  /** Status shown when no live status has been published for the view. */
  idleStatus?: (view: WorkbenchView) => ViewStatus | undefined;
}

export class ViewRegistry extends Registry<ViewDefinition> {}
