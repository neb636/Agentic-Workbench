import type { ComponentType } from "react";
import { Registry } from "./registry";
import type { AgentDeliveryResult, AgentModelSettings, AgentPromptRequest, AgentResume, AgentSessionStatus, AgentSessionSnapshot, PtySnapshot } from "../../shared/models";

export interface SessionCreateContext {
  workspacePath: string;
  cols?: number;
  rows?: number;
  viewId?: string;
  resume?: AgentResume;
  /** Model and effort for a new conversation (launch arguments; a resumed one keeps its own). */
  settings?: AgentModelSettings;
}

/** `dispose` lets go of the session in this window; `terminate` ends it. */
export interface SessionController {
  id: string;
  dispose: () => void;
  terminate: () => void;
}

export interface TerminalSessionController extends SessionController {
  kind: "terminal";
  input: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  /** Shows the screen as it is, then the output after it; returns detach. */
  attach: (snapshot: (snapshot: PtySnapshot) => void, data: (data: string) => void, error: (message: string) => void) => () => void;
  /** Called at once if the shell already exited. */
  onExit: (listener: (exitCode: number) => void) => () => void;
}

export interface AgentSessionController extends SessionController {
  kind: "agent";
  /** Set when the CLI runs a conversation with a known id. */
  conversationId?: string;
  input: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  attach: (snapshot: (snapshot: AgentSessionSnapshot) => void, data: (data: string) => void, error: (message: string) => void) => () => void;
  sendPrompt: (request: AgentPromptRequest) => Promise<AgentDeliveryResult>;
  interrupt: () => void;
  onStatus: (listener: (status: AgentSessionStatus) => void) => () => void;
}

interface SessionProviderBase {
  id: string;
  label: string;
  /** Short secondary text, such as the vendor. */
  description?: string;
  /** The mark shown wherever this provider is named or chosen. */
  icon?: ComponentType<{ size?: number }>;
}

export interface TerminalSessionProvider extends SessionProviderBase {
  kind: "terminal";
  create: (context: SessionCreateContext) => Promise<TerminalSessionController>;
}

export interface AgentProvider extends SessionProviderBase {
  kind: "agent";
  create: (context: SessionCreateContext) => Promise<AgentSessionController>;
}

export type SessionProvider = TerminalSessionProvider | AgentProvider;

export class SessionProviderRegistry extends Registry<SessionProvider> {
  firstAgent(): AgentProvider | undefined {
    return this.list().find((provider): provider is AgentProvider => provider.kind === "agent");
  }
}
