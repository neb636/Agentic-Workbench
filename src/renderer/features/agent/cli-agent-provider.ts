import type { ComponentType } from "react";
import type { AgentProvider } from "../../core/session-provider-registry";
import type { AgentSessionEvent, AgentSessionStatus } from "../../../shared/models";
import { onAgentSessionEvent } from "../../core/session-events";

export function cliAgentProvider(id: string, label: string, description?: string, icon?: ComponentType<{ size?: number }>): AgentProvider {
  return { id, label, description, icon, kind: "agent", async create(context) {
    if (!context.viewId) throw new Error("Agent sessions require an owning view.");
    const sessionId = await window.workbench.agent.create({ providerId: id, workspacePath: context.workspacePath,
      viewId: context.viewId, cols: context.cols ?? 100, rows: context.rows ?? 24, resume: context.resume, settings: context.settings });
    let status: AgentSessionStatus | undefined;
    let statusSequence = 0;
    let conversationId: string | undefined;
    const listeners = new Set<(status: AgentSessionStatus) => void>();
    const attachments = new Set<() => void>();
    const off = onAgentSessionEvent(sessionId, (event) => {
      if (event.type === "status") {
        statusSequence = event.sequence;
        status = event.status;
        listeners.forEach((listener) => listener(event.status));
      }
    });
    try {
      const initial = await window.workbench.agent.attach(sessionId);
      if (initial.sequence >= statusSequence) status = initial.status;
      conversationId = initial.conversationId;
    } catch (error) { off(); window.workbench.agent.terminate(sessionId); throw error; }
    return {
      id: sessionId,
      kind: "agent",
      conversationId,
      input: (data) => window.workbench.agent.input(sessionId, data),
      resize: (cols, rows) => window.workbench.agent.resize(sessionId, cols, rows),
      sendPrompt: (request) => window.workbench.agent.sendPrompt(sessionId, request),
      interrupt: () => window.workbench.agent.interrupt(sessionId),
      onStatus: (listener) => { listeners.add(listener); if (status) listener(status); return () => { listeners.delete(listener); }; },
      attach: (onSnapshot, onData, onError) => {
        let active = true;
        let sequence: number | undefined;
        const pending: AgentSessionEvent[] = [];
        const consume = (event: AgentSessionEvent) => {
          if (!active) return;
          if (sequence === undefined) { pending.push(event); return; }
          if (event.sequence <= sequence) return;
          sequence = event.sequence;
          if (event.type === "data") onData(event.data);
        };
        const unsubscribe = onAgentSessionEvent(sessionId, consume);
        const detach = () => { active = false; unsubscribe(); attachments.delete(detach); };
        attachments.add(detach);
        void window.workbench.agent.attach(sessionId).then((snapshot) => {
          if (!active) return;
          onSnapshot(snapshot);
          sequence = snapshot.sequence;
          pending.splice(0).forEach(consume);
        }).catch((error: unknown) => { if (active) onError(String(error)); detach(); });
        return detach;
      },
      dispose: () => { off(); attachments.forEach((detach) => detach()); listeners.clear(); },
      terminate: () => window.workbench.agent.terminate(sessionId),
    };
  } };
}
