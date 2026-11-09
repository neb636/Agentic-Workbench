import { useContextMenu } from "../../ui/ContextMenu";
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { AgentSessionController, TerminalSessionController } from "../../core/session-provider-registry";
import { pathsInLine } from "../../../shared/terminal-paths";

export interface TerminalSurfaceHandle { focus: () => void; }

export function TerminalSurface({ controller, ref, onSelectionChange, root, onOpenPath }: {
  controller: AgentSessionController | TerminalSessionController;
  ref?: Ref<TerminalSurfaceHandle>;
  onSelectionChange?: (text: string) => void;
  /** The folder the session runs in: paths in the output that are its files become links (`onOpenPath` opens them). */
  root?: string;
  onOpenPath?: (path: string, line?: number) => void;
}) {
  const [exited, setExited] = useState(false);
  const menu = useContextMenu("Terminal actions");
  const openPath = useRef(onOpenPath);
  useEffect(() => { openPath.current = onOpenPath; }, [onOpenPath]);
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const selectionCallback = useRef(onSelectionChange);
  useEffect(() => { selectionCallback.current = onSelectionChange; }, [onSelectionChange]);
  useImperativeHandle(ref, () => ({ focus: () => terminalRef.current?.focus() }), []);
  useEffect(() => {
    setExited(false);
    const host = hostRef.current;
    if (!host) return;
    const styles = getComputedStyle(document.documentElement);
    const token = (name: string) => styles.getPropertyValue(name).trim();
    const terminal = new Terminal({ cursorBlink: true, fontFamily: token("--wb-font-mono"), fontSize: 13, lineHeight: 1.25,
      scrollback: 2000, theme: {
        background: token("--wb-terminal-bg"), foreground: token("--wb-terminal-fg"), cursor: token("--wb-terminal-cursor"),
        selectionBackground: token("--wb-terminal-selection"), black: token("--wb-terminal-black"), red: token("--wb-terminal-red"),
        green: token("--wb-terminal-green"), yellow: token("--wb-terminal-yellow"), blue: token("--wb-terminal-blue"),
        magenta: token("--wb-terminal-magenta"), cyan: token("--wb-terminal-cyan"), white: token("--wb-terminal-white"),
      },
    });
    const fit = new FitAddon(); terminal.loadAddon(fit); terminal.open(host);
    terminalRef.current = terminal;
    const selection = terminal.onSelectionChange(() => selectionCallback.current?.(terminal.getSelection()));
    // Paths in the output open that file (at that line) when clicked; only real files under the root are links.
    const known = new Map<string, boolean>();
    const links = root ? terminal.registerLinkProvider({
      provideLinks: (y, callback) => {
        const text = terminal.buffer.active.getLine(y - 1)?.translateToString(true) ?? "";
        const candidates = pathsInLine(text, root);
        if (!candidates.length) { callback(undefined); return; }
        const unknown = [...new Set(candidates.map((item) => item.path).filter((path) => !known.has(path)))];
        const ready = unknown.length ? window.workbench.files.exists(root, unknown).then((found) => {
          for (const path of unknown) known.set(path, found.includes(path));
          if (known.size > 2000) known.clear();
        }).catch(() => undefined) : Promise.resolve();
        void ready.then(() => callback(candidates.filter((item) => known.get(item.path)).map((item) => ({
          range: { start: { x: item.start + 1, y }, end: { x: item.start + item.length, y } },
          text: text.slice(item.start, item.start + item.length),
          decorations: { underline: true, pointerCursor: true },
          activate: () => openPath.current?.(item.path, item.line),
        }))));
      },
    }) : undefined;
    let active = true;
    let attached = false;
    let followOutput = true;
    const write = (data: string) => terminal.write(data, () => { if (active && followOutput) terminal.scrollToBottom(); });
    const wheel = (event: WheelEvent) => { if (event.deltaY < 0) followOutput = false; };
    const pointer = (event: PointerEvent) => { if ((event.target as HTMLElement).classList.contains("xterm-viewport")) followOutput = false; };
    host.addEventListener("wheel", wheel, { passive: true });
    host.addEventListener("pointerdown", pointer);
    const scroll = terminal.onScroll(() => {
      if (terminal.buffer.active.viewportY === terminal.buffer.active.baseY) followOutput = true;
    });
    const resize = () => {
      if (active && attached && host.clientWidth && host.clientHeight) {
        fit.fit(); controller.resize?.(terminal.cols, terminal.rows);
        if (followOutput) terminal.scrollToBottom();
      }
    };
    let detach: (() => void) | undefined;
    let offExit: (() => void) | undefined;
    let offStatus: (() => void) | undefined;
    if ("attach" in controller) {
      offStatus = controller.onStatus((status) => setExited(status.lifecycle === "exited" || status.lifecycle === "failed" || status.inputState === "unavailable"));
      for (const identifier of [{ final: "c" }, { prefix: ">", final: "c" }, { final: "n" }, { prefix: "?", final: "n" }, { final: "t" }]) {
        terminal.parser.registerCsiHandler(identifier, () => true);
      }
      // Colour queries too (Codex asks for the foreground and background): answering them here sent a second reply.
      for (const ident of [10, 11, 12]) terminal.parser.registerOscHandler(ident, (data) => data.split(";").includes("?"));
      // The headless terminal answers protocol queries; this surface only forwards user input.
      detach = controller.attach((snapshot) => {
        terminal.resize(snapshot.cols, snapshot.rows);
        terminal.write(snapshot.screen, () => { attached = true; resize(); terminal.scrollToBottom(); });
      }, write, (message) => write(`\r\n${message}\r\n`));
    } else {
      attached = true; resize();
      detach = controller.onData?.(write);
      offExit = controller.onExit?.((code) => { setExited(true); write(`\r\nProcess exited with code ${code}\r\n`); });
    }
    const input = terminal.onData((data) => { if (attached) { followOutput = true; controller.input?.(data); } });
    const observer = new ResizeObserver(resize); observer.observe(host);
    return () => {
      active = false; observer.disconnect(); detach?.(); offExit?.(); offStatus?.(); input.dispose(); scroll.dispose();
      selection.dispose(); links?.dispose(); terminalRef.current = null;
      host.removeEventListener("wheel", wheel); host.removeEventListener("pointerdown", pointer); terminal.dispose();
    };
  }, [controller, root]);
  return <><div className="terminal-host" ref={hostRef} aria-label="Native CLI terminal" {...menu.bind(() => {
    const terminal = terminalRef.current;
    return [
      { id: "copy", label: "Copy Selection", disabled: !terminal?.hasSelection(), run: () => navigator.clipboard.writeText(terminal?.getSelection() ?? "") },
      { id: "paste", label: "Paste", disabled: !controller.input || exited, run: async () => { const text = await navigator.clipboard.readText(); terminal?.paste(text); terminal?.focus(); } },
      { id: "select-all", label: "Select All", run: () => terminal?.selectAll() },
      { id: "bottom", label: "Scroll to Bottom", run: () => terminal?.scrollToBottom() },
      ...(!("attach" in controller) ? [{ id: "clear", label: "Clear Display", run: () => terminal?.clear() }] : []),
    ];
  })} />{menu.overlay}</>;
}
