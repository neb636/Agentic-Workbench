import { useEffect, useState } from "react";
import { Autocomplete, Dialog, Input, ListBox, ListBoxItem, Modal, ModalOverlay, SearchField } from "react-aria-components";
import { services } from "../../core/services";
import { useWorkbenchStore } from "../../state/workbench-store";
import { FileIcon, SearchIcon } from "../../ui/icons";
import { useQuickOpen } from "./file-commands";
import { isFilesWorkspace } from "../../../shared/files-workspace";

/** ⌘P: type part of a file's name; Enter opens it as a preview tab in the workspace on screen. */
export function QuickOpen() {
  const open = useQuickOpen((state) => state.open);
  const active = useWorkbenchStore((state) => state.workspaces.find((item) => item.id === state.activeWorkspaceId) ?? state.workspaces[0]);
  // The Files workspace has no folder to search.
  const workspace = active && !isFilesWorkspace(active) ? active : undefined;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<string[]>([]);
  const close = () => { useQuickOpen.setState({ open: false }); setQuery(""); setResults([]); };

  useEffect(() => {
    if (!open || !workspace) return;
    const text = query.trim();
    if (!text) { setResults([]); return; }
    let active = true;
    const timer = setTimeout(() => void window.workbench.files.find(workspace.path, text).then((found) => {
      if (active) setResults(found.slice(0, 50));
    }).catch(() => undefined), 60);
    return () => { active = false; clearTimeout(timer); };
  }, [open, query, workspace]);

  if (!open || !workspace) return null;
  const choose = (path: string) => {
    void services.commands.execute("file.open", { workspaceId: workspace.id, root: workspace.path, path, preview: true });
    close();
  };
  return <ModalOverlay className="wb-modal-overlay quick-open-overlay" isOpen isDismissable onOpenChange={(value) => { if (!value) close(); }}>
    <Modal className="wb-modal quick-open">
      <Dialog aria-label="Go to file" className="wb-dialog">
        {/* The main process ranks matches, so the list is shown as returned rather than filtered again here. */}
        <Autocomplete inputValue={query} onInputChange={setQuery}>
          <SearchField aria-label="File name" className="panel-search quick-open-search" autoFocus>
            <SearchIcon size={14} /><Input placeholder={`Go to a file in ${workspace.name}…`} />
          </SearchField>
          <ListBox aria-label="Files" className="quick-open-list" items={results.map((path) => ({ id: path }))}
            onAction={(key) => choose(String(key))}
            renderEmptyState={() => query.trim() ? <p className="panel-empty">No file matches “{query}”.</p> : null}>
            {(item) => <ListBoxItem id={item.id} textValue={item.id} className="quick-open-item">
              <FileIcon size={14} /><span>{item.id.split("/").at(-1)}</span><small>{item.id.split("/").slice(0, -1).join("/")}</small>
            </ListBoxItem>}
          </ListBox>
        </Autocomplete>
      </Dialog>
    </Modal>
  </ModalOverlay>;
}
