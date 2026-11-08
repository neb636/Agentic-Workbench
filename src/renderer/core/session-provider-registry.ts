import { Registry } from "./registry";
import type { AgentDeliveryResult, AgentModelSettings, AgentPromptRequest, AgentSessionStatus, AgentSessionSnapshot } from "../../shared/models";

export interface SessionCreateContext {
  workspacePath: string;
  cols?: number;
  rows?: number;
  viewId?: string;
  resume?: boolean;
  /** Model and effort for a new conversation (launch arguments; a resumed one keeps its own). */
  settings?: AgentModelSettings;
}

export interface SessionController {
  id: string;
  dispose: () => void;
}

export interface TerminalSessionController extends SessionController {
  input?: (data: string) => void;
  resize?: (cols: number, rows: number) => void;
  onData?: (listener: (data: string) => void) => () => void;
  onExit?: (listener: (exitCode: number) => void) => () => void;
}

export interface AgentSessionController extends SessionController {
  input: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  attach: (snapshot: (snapshot: AgentSessionSnapshot) => void, data: (data: string) => void, error: (message: string) => void) => () => void;
  sendPrompt: (request: AgentPromptRequest) => Promise<AgentDeliveryResult>;
  interrupt: () => void;
  onStatus: (listener: (status: AgentSessionStatus) => void) => () => void;
  terminate: () => void;
}

interface SessionProviderBase {
  id: string;
  label: string;
  /** Short secondary text, such as the vendor. */
  description?: string;
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
