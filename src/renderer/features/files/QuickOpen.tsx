import { useEffect, useState } from "react";
import { Dialog, Modal, ModalOverlay } from "react-aria-components";
import { services } from "../../core/services";
import { useWorkbenchStore } from "../../state/workbench-store";
import { FileIcon } from "../../ui/icons";
import { useQuickOpen } from "./file-commands";

/** ⌘P: type part of a file's name, Enter opens it (in the piece of work on screen). */
export function QuickOpen() {
  const open = useQuickOpen((state) => state.open);
  const workspace = useWorkbenchStore((state) => state.workspaces.find((item) => item.id === state.activeWorkspaceId) ?? state.workspaces[0]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const close = () => { useQuickOpen.setState({ open: false }); setQuery(""); setResults([]); setIndex(0); };
  useEffect(() => {
    if (!open || !workspace) return;
    const text = query.trim();
    if (!text) { setResults([]); return; }
    let active = true;
    const timer = setTimeout(() => void window.workbench.files.find(workspace.path, text).then((found) => {
      if (active) { setResults(found.slice(0, 50)); setIndex(0); }
    }).catch(() => undefined), 60);
    return () => { active = false; clearTimeout(timer); };
  }, [open, query, workspace]);
  if (!open || !workspace) return null;
  const choose = (path: string | undefined, keep = false) => {
    if (!path) return;
    void services.commands.execute("file.open", { workspaceId: workspace.id, root: workspace.path, path, preview: !keep });
    close();
  };
  return <ModalOverlay className="wb-modal-overlay quick-open-overlay" isOpen isDismissable onOpenChange={(value) => { if (!value) close(); }}>
    <Modal className="wb-modal quick-open">
      <Dialog aria-label="Go to file" className="wb-dialog">
        <input autoFocus className="quick-open-input" aria-label="File name" placeholder={`Go to a file in ${workspace.name}…`} value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") { event.preventDefault(); setIndex((value) => Math.min(results.length - 1, value + 1)); }
            else if (event.key === "ArrowUp") { event.preventDefault(); setIndex((value) => Math.max(0, value - 1)); }
            else if (event.key === "Enter") { event.preventDefault(); choose(results[index], event.metaKey); }
          }} />
        <ul className="quick-open-list" role="listbox" aria-label="Files">
          {results.map((path, at) => <li key={path} role="option" aria-selected={at === index} className={at === index ? "is-selected" : ""}
            onMouseEnter={() => setIndex(at)} onClick={() => choose(path)}>
            <FileIcon size={14} /><span>{path.split("/").at(-1)}</span><small>{path.split("/").slice(0, -1).join("/")}</small>
          </li>)}
          {query.trim() && !results.length && <li className="quick-open-empty">No file matches “{query}”.</li>}
        </ul>
      </Dialog>
    </Modal>
  </ModalOverlay>;
}
