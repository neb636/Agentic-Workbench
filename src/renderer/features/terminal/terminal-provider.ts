import type { TerminalSessionProvider } from "../../core/session-provider-registry";
import { onPtyData, onPtyExit } from "../../core/session-events";

/** The main process keeps each terminal's screen, so a view can let go of it on a tab switch and attach again later. */
export const localTerminalProvider: TerminalSessionProvider = {
  id: "terminal.local",
  label: "Local terminal",
  kind: "terminal",
  async create(context) {
    const sessionId = await window.workbench.pty.create({
      cwd: context.workspacePath,
      cols: context.cols ?? 80,
      rows: context.rows ?? 24,
      viewId: context.viewId,
    });
    let exitCode: number | undefined;
    const exitListeners = new Set<(code: number) => void>();
    const attachments = new Set<() => void>();
    const exited = (code: number) => {
      if (exitCode !== undefined) return;
      exitCode = code;
      exitListeners.forEach((listener) => listener(code));
    };
    const offExit = onPtyExit(sessionId, (event) => exited(event.exitCode));
    let disposed = false;

    return {
      id: sessionId,
      kind: "terminal",
      input: (data) => window.workbench.pty.input(sessionId, data),
      resize: (cols, rows) => window.workbench.pty.resize(sessionId, cols, rows),
      attach: (onSnapshot, onData, onError) => {
        let active = true;
        let sequence: number | undefined;
        const pending: { sequence: number; data: string }[] = [];
        const consume = (event: { sequence: number; data: string }) => {
          if (!active) return;
          if (sequence === undefined) { pending.push(event); return; }
          if (event.sequence <= sequence) return;
          sequence = event.sequence;
          onData(event.data);
        };
        const offData = onPtyData(sessionId, consume);
        const detach = () => { active = false; offData(); attachments.delete(detach); };
        attachments.add(detach);
        void window.workbench.pty.attach(sessionId).then((snapshot) => {
          if (!active) return;
          onSnapshot(snapshot);
          sequence = snapshot.sequence;
          pending.splice(0).forEach(consume);
          if (snapshot.exitCode !== undefined) exited(snapshot.exitCode);
        }).catch((error: unknown) => { if (active) onError(String(error)); detach(); });
        return detach;
      },
      onExit: (listener) => {
        exitListeners.add(listener);
        if (exitCode !== undefined) listener(exitCode);
        return () => exitListeners.delete(listener);
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        offExit();
        attachments.forEach((detach) => detach());
        exitListeners.clear();
      },
      terminate: () => window.workbench.pty.terminate(sessionId),
    };
  },
};
