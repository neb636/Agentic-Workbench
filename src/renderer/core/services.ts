import { ContextMenuRegistry } from "./context-menu-registry";
import { CommandRegistry } from "./command-registry";
import { PromptAssembler } from "./prompt-assembler";
import { SessionProviderRegistry } from "./session-provider-registry";
import { ViewRegistry } from "./view-registry";
import { WidgetRegistry } from "./widget-registry";
import { PromptContributorRegistry } from "./prompt-contributor-registry";
import { PromptMenuRegistry } from "./prompt-menu-registry";
import { PanelRegistry } from "./panel-registry";
import { EventBus } from "./event-bus";
import { SendGuardRegistry } from "./send-guard-registry";

export const services = {
  contextMenus: new ContextMenuRegistry(),
  views: new ViewRegistry(),
  sessions: new SessionProviderRegistry(),
  commands: new CommandRegistry(),
  widgets: new WidgetRegistry(),
  promptAssembler: new PromptAssembler(),
  promptContributors: new PromptContributorRegistry(),
  promptMenus: new PromptMenuRegistry(),
  panels: new PanelRegistry(),
  sendGuards: new SendGuardRegistry(),
  events: new EventBus(),
};
