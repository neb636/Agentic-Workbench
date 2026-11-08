import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button as AriaButton,
  Disclosure,
  DisclosurePanel,
  GridList,
  GridListItem,
  Heading,
  Input,
  Label,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
  SearchField,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tree,
  TreeItem,
  TreeItemContent,
  type Key,
} from "react-aria-components";
import type { FileEntry, FileViewState, SearchMatch, SearchResult, SourceControlChange } from "../../../shared/models";
import { errorMessage } from "../../core/errors";
import type { PanelProps } from "../../core/panel-registry";
import { services } from "../../core/services";
import { watchWorkspace } from "../../core/workspace-watch";
import { useWorkbenchStore } from "../../state/workbench-store";
import { IconButton } from "../../ui/controls";
import { ChevronRightIcon, CloseIcon, FileIcon, FolderIcon, MoreIcon, PlusIcon, RefreshIcon, SearchIcon } from "../../ui/icons";
import { type FileSearchMode, useExplorerRequests } from "../explorer/explorer-store";
import { CHANGE_LETTERS, useSourceControlStatus } from "../source-control/source-control-store";

type Listing = FileEntry[] | { error: string };

const parentOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const ancestorsOf = (path: string) => path.split("/").slice(0, -1).map((_, index, parts) => parts.slice(0, index + 1).join("/"));
const revealLabel = window.workbench.platform === "darwin" ? "Reveal in Finder" : window.workbench.platform === "win32" ? "Reveal in File Explorer" : "Reveal in file manager";

/** A name typed for a new file or folder, or a rename. */
function NameForm({ title, initial, onSubmit, onCancel }: { title: string; initial: string; onSubmit: (name: string) => Promise<void>; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState("");
  return <form className="file-name-form" onSubmit={(event) => {
    event.preventDefault();
    if (!value.trim()) return;
    void onSubmit(value.trim()).catch((caught: unknown) => setError(errorMessage(caught)));
  }}>
    <TextField value={value} onChange={setValue} autoFocus onKeyDown={(event) => { if (event.key === "Escape") onCancel(); }}>
      <Label>{title}</Label>
      <Input onFocus={(event) => { const dot = event.target.value.lastIndexOf("."); event.target.setSelectionRange(0, dot > 0 ? dot : event.target.value.length); }} />
    </TextField>
    {error && <small className="panel-error" role="alert">{error}</small>}
  </form>;
}

/**
 * The workspace's tree with what source control says about each file (M / A / U, ignored files dimmed), search by
 * name or inside files, and a menu per row. One click opens a preview tab; a double click or an edit keeps it.
 */
export function FilesPanel({ workspace }: PanelProps) {
  const root = workspace.path;
  const [listings, setListings] = useState<Record<string, Listing>>({});
  const [expanded, setExpanded] = useState<Set<Key>>(new Set());
  const [mode, setMode] = useState<FileSearchMode>("names");
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regex, setRegex] = useState(false);
  const [names, setNames] = useState<string[]>();
  const [contents, setContents] = useState<SearchResult & { error?: string; busy?: boolean }>();
  const [ignored, setIgnored] = useState<Set<string>>(new Set());
  const [form, setForm] = useState<{ kind: "file" | "directory" | "rename"; path: string }>();
  const [notice, setNotice] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const loaded = useRef<string[]>([]);
  useEffect(() => { loaded.current = Object.keys(listings); }, [listings]);
  const status = useSourceControlStatus(root, true)?.status;
  const activeFile = useWorkbenchStore((state) => {
    const current = state.workspaces.find((item) => item.id === workspace.id);
    const view = current?.views.find((item) => item.id === current.activeViewId);
    const file = view?.type === "file" ? view.state as FileViewState : undefined;
    return file?.root === root ? file.path : undefined;
  });

  const load = useCallback((directory: string) => {
    window.workbench.files.list(root, directory)
      .then((entries) => setListings((current) => ({ ...current, [directory]: entries })))
      .catch((e: unknown) => setListings((current) => ({ ...current, [directory]: { error: errorMessage(e) } })));
  }, [root]);
  const loadIgnored = useCallback(() => {
    void window.workbench.sourceControl.ignored(root).then((paths) => setIgnored(new Set(paths))).catch(() => undefined);
  }, [root]);

  useEffect(() => { setListings({}); setExpanded(new Set()); load(""); loadIgnored(); }, [load, loadIgnored]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = watchWorkspace(root, () => {
      clearTimeout(timer);
      timer = setTimeout(() => { loaded.current.forEach(load); loadIgnored(); }, 250);
    });
    return () => { clearTimeout(timer); off(); };
  }, [root, load, loadIgnored]);

  // ⇧⌘F (or another request): focus the search in that mode.
  const request = useExplorerRequests((state) => state.search);
  useEffect(() => {
    if (!request) return;
    setMode(request.mode);
    const timer = setTimeout(() => { searchRef.current?.focus(); searchRef.current?.select(); }, 0);
    return () => clearTimeout(timer);
  }, [request]);

  useEffect(() => {
    const text = query.trim();
    if (!text || mode !== "names") { setNames(undefined); return; }
    let active = true;
    const timer = setTimeout(() => {
      void window.workbench.files.find(root, text).then((found) => { if (active) setNames(found); }).catch(() => { if (active) setNames([]); });
    }, 120);
    return () => { active = false; clearTimeout(timer); };
  }, [root, query, mode]);
  useEffect(() => {
    const text = query.trim();
    if (!text || mode !== "contents") { setContents(undefined); return; }
    let active = true;
    const timer = setTimeout(() => {
      setContents((current) => ({ matches: current?.matches ?? [], limited: false, busy: true }));
      void window.workbench.files.search(root, text, { caseSensitive, regex })
        .then((result) => { if (active) setContents(result); })
        .catch((caught: unknown) => { if (active) setContents({ matches: [], limited: false, error: errorMessage(caught) }); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [root, query, mode, caseSensitive, regex]);

  // The file on screen is shown in the tree: its folders open and its row is highlighted.
  useEffect(() => {
    if (!activeFile) return;
    const folders = ancestorsOf(activeFile);
    for (const folder of folders) if (!loaded.current.includes(folder)) load(folder);
    setExpanded((current) => folders.every((folder) => current.has(folder)) ? current : new Set([...current, ...folders]));
    const timer = setTimeout(() => treeRef.current?.querySelector(`[data-path="${CSS.escape(activeFile)}"]`)?.scrollIntoView({ block: "nearest" }), 200);
    return () => clearTimeout(timer);
  }, [activeFile, load]);

  const marks = useMemo(() => {
    const files = new Map<string, SourceControlChange["kind"]>();
    const folders = new Set<string>();
    for (const change of status?.changes ?? []) {
      files.set(change.path, change.kind);
      for (const folder of ancestorsOf(change.path)) folders.add(folder);
    }
    return { files, folders };
  }, [status]);
  const isIgnored = (path: string) => ignored.has(path) || ancestorsOf(path).some((folder) => ignored.has(folder));

  const open = (path: string, options: { preview?: boolean; line?: number } = {}) =>
    void services.commands.execute("file.open", { workspaceId: workspace.id, root, path, preview: options.preview ?? true, line: options.line });
  const entryFor = (path: string): FileEntry | undefined => {
    const listing = listings[parentOf(path)];
    return Array.isArray(listing) ? listing.find((entry) => entry.path === path) : undefined;
  };
  const changeExpanded = (keys: Set<Key>) => {
    for (const key of keys) if (!expanded.has(key) && !listings[String(key)]) load(String(key));
    setExpanded(keys);
  };
  const act = async (action: string, entry: FileEntry) => {
    setNotice("");
    const folder = entry.kind === "directory" ? entry.path : parentOf(entry.path);
    if (action === "new-file") setForm({ kind: "file", path: folder });
    else if (action === "new-folder") setForm({ kind: "directory", path: folder });
    else if (action === "rename") setForm({ kind: "rename", path: entry.path });
    else if (action === "copy") {
      try { await navigator.clipboard.writeText(entry.path); setNotice(`Copied ${entry.path}`); }
      catch (caught) { setNotice(errorMessage(caught)); }
    } else if (action === "reveal") window.workbench.files.reveal(root, entry.path);
    else if (action === "trash") {
      if (!window.confirm(`Move ${entry.path} to the trash?${entry.kind === "directory" ? "\n\nEverything inside it goes too." : ""}`)) return;
      try { await window.workbench.files.trash(root, entry.path); load(parentOf(entry.path)); setNotice(`Moved ${entry.name} to the trash`); }
      catch (caught) { setNotice(errorMessage(caught)); }
    }
  };
  const submitForm = async (name: string) => {
    if (!form) return;
    if (form.kind === "rename" && name.includes("/")) throw new Error("Use a name, not a path.");
    if (form.kind === "rename") {
      const target = parentOf(form.path) ? `${parentOf(form.path)}/${name}` : name;
      await window.workbench.files.rename(root, form.path, target);
      load(parentOf(form.path));
    } else {
      const target = form.path ? `${form.path}/${name}` : name;
      await window.workbench.files.create(root, target, form.kind);
      load(form.path);
      if (form.path) setExpanded((current) => new Set([...current, form.path]));
      if (form.kind === "file") open(target, { preview: false });
    }
    setForm(undefined);
  };

  const renderEntries = (directory: string) => {
    const listing = listings[directory];
    if (!listing) return [<TreeItem key={`${directory}/…`} id={`${directory}/…`} textValue="Loading" className="file-tree-item is-placeholder">
      <TreeItemContent><span className="file-tree-note">Loading…</span></TreeItemContent></TreeItem>];
    if (!Array.isArray(listing)) return [<TreeItem key={`${directory}/!`} id={`${directory}/!`} textValue="Error" className="file-tree-item is-placeholder">
      <TreeItemContent><span className="file-tree-note">{listing.error}</span></TreeItemContent></TreeItem>];
    return listing.map((entry) => {
      const kind = marks.files.get(entry.path);
      const classes = ["file-tree-item", isIgnored(entry.path) && "is-ignored", activeFile === entry.path && "is-current"].filter(Boolean).join(" ");
      return <TreeItem key={entry.path} id={entry.path} textValue={entry.name} className={classes} hasChildItems={entry.kind === "directory"}>
        <TreeItemContent>
          {({ level, isExpanded }) => <div className="file-tree-row" data-path={entry.path} style={{ paddingInlineStart: 6 + (level - 1) * 14 }}
            onDoubleClick={() => { if (entry.kind === "file") open(entry.path, { preview: false }); }}>
            {entry.kind === "directory"
              ? <AriaButton slot="chevron" className={`tree-chevron ${isExpanded ? "is-expanded" : ""}`} aria-label={isExpanded ? `Collapse ${entry.name}` : `Expand ${entry.name}`}><ChevronRightIcon size={12} /></AriaButton>
              : <span className="tree-chevron-spacer" />}
            {entry.kind === "directory" ? <FolderIcon size={14} /> : <FileIcon size={14} />}
            <span className="file-tree-name">{entry.name}</span>
            {kind ? <span className={`change-letter kind-${kind}`} title={kind}>{CHANGE_LETTERS[kind]}</span>
              : entry.kind === "directory" && marks.folders.has(entry.path) ? <span className="change-dot" title="Has changes" /> : null}
            <MenuTrigger>
              <AriaButton className="row-action" aria-label={`${entry.name} actions`}><MoreIcon size={13} /></AriaButton>
              <Popover className="wb-popover" placement="bottom end">
                <Menu aria-label={`${entry.name} actions`} onAction={(key) => void act(String(key), entry)}>
                  <MenuItem id="new-file">New file…</MenuItem>
                  <MenuItem id="new-folder">New folder…</MenuItem>
                  <MenuItem id="rename">Rename…</MenuItem>
                  <MenuItem id="copy">Copy path</MenuItem>
                  <MenuItem id="reveal">{revealLabel}</MenuItem>
                  <MenuItem id="trash" className="is-destructive">Move to trash…</MenuItem>
                </Menu>
              </Popover>
            </MenuTrigger>
          </div>}
        </TreeItemContent>
        {entry.kind === "directory" && expanded.has(entry.path) && renderEntries(entry.path)}
      </TreeItem>;
    });
  };

  const grouped = useMemo(() => {
    const files = new Map<string, SearchMatch[]>();
    for (const match of contents?.matches ?? []) files.set(match.path, [...(files.get(match.path) ?? []), match]);
    return [...files];
  }, [contents]);

  return <div className="side-panel files-panel">
    <div className="side-panel-header">
      <h2>{workspace.name}</h2>
      <span className="header-actions">
        <IconButton label="New file at the top" onPress={() => setForm({ kind: "file", path: "" })}><PlusIcon size={14} /></IconButton>
        <IconButton label="Refresh files" onPress={() => { Object.keys(listings).forEach(load); loadIgnored(); }}><RefreshIcon size={14} /></IconButton>
      </span>
    </div>
    <div className="file-search">
      <ToggleButtonGroup aria-label="Search by" className="segmented file-search-mode" selectionMode="single" disallowEmptySelection
        selectedKeys={[mode]} onSelectionChange={(keys) => { const key = [...keys][0]; if (key) setMode(key as FileSearchMode); }}>
        <ToggleButton id="names" className="segment">Names</ToggleButton>
        <ToggleButton id="contents" className="segment">Contents</ToggleButton>
      </ToggleButtonGroup>
      <div className="panel-search file-search-field">
        <SearchField className="file-search-input" aria-label={mode === "names" ? "Find files" : "Search inside files"} value={query} onChange={setQuery}>
          <SearchIcon size={14} /><Input ref={searchRef} placeholder={mode === "names" ? "Find files…  ⌘P" : "Search inside files…  ⇧⌘F"} />
          {query && <AriaButton aria-label="Clear search"><CloseIcon size={12} /></AriaButton>}
        </SearchField>
        {mode === "contents" && <>
          <ToggleButton className="search-option" aria-label="Match case" isSelected={caseSensitive} onChange={setCaseSensitive}>Aa</ToggleButton>
          <ToggleButton className="search-option" aria-label="Regular expression" isSelected={regex} onChange={setRegex}>.*</ToggleButton>
        </>}
      </div>
    </div>
    {form && <NameForm key={`${form.kind}:${form.path}`} title={form.kind === "rename" ? `Rename ${form.path}` : `New ${form.kind === "file" ? "file" : "folder"} in ${form.path || "the top folder"}`}
      initial={form.kind === "rename" ? form.path.split("/").at(-1) ?? "" : ""} onSubmit={submitForm} onCancel={() => setForm(undefined)} />}
    {notice && <p className="panel-note" role="status">{notice}</p>}
    {names ? (
      <GridList aria-label="Matching files" className="panel-list" items={names.map((path) => ({ id: path }))} onAction={(key) => open(String(key))}
        renderEmptyState={() => <p className="panel-empty">No files match “{query}”.</p>}>
        {(item) => <GridListItem id={item.id} textValue={item.id} className="panel-list-item">
          <FileIcon size={14} /><span className="file-tree-name">{item.id.split("/").at(-1)}</span><small>{parentOf(item.id)}</small>
        </GridListItem>}
      </GridList>
    ) : contents ? (
      <div className="panel-list search-results" aria-label="Matches inside files">
        {contents.error && <p className="panel-empty panel-error" role="alert">{contents.error}</p>}
        {!contents.busy && !contents.error && grouped.length === 0 && <p className="panel-empty">Nothing inside the files matches “{query}”.</p>}
        {grouped.length > 0 && <p className="panel-note">{contents.matches.length}{contents.limited ? "+" : ""} matches in {grouped.length} files{contents.limited ? " (stopped at the limit)" : ""}</p>}
        {grouped.map(([path, lines]) => <Disclosure key={path} defaultExpanded className="search-file">
          <Heading className="search-file-heading">
            <AriaButton slot="trigger" className="search-file-trigger">
              <ChevronRightIcon size={11} /><FileIcon size={13} /><span className="file-tree-name">{path.split("/").at(-1)}</span>
              <small>{parentOf(path)}</small><span className="count-badge">{lines.length}</span>
            </AriaButton>
          </Heading>
          <DisclosurePanel>
            <GridList aria-label={`Matches in ${path}`} className="search-lines" items={lines.map((match) => ({ ...match, id: `${match.line}` }))}
              onAction={(key) => open(path, { line: Number(key) })}>
              {(match) => <GridListItem id={match.id} textValue={match.text} className="search-line">
                <small>{match.line}</small><code>{match.text.trim()}</code>
              </GridListItem>}
            </GridList>
          </DisclosurePanel>
        </Disclosure>)}
      </div>
    ) : (
      <div ref={treeRef} className="file-tree-scroll">
        <Tree aria-label={`Files in ${workspace.name}`} className="file-tree" expandedKeys={expanded} onExpandedChange={changeExpanded}
          onAction={(key) => {
            const entry = entryFor(String(key));
            if (entry?.kind === "file") open(entry.path);
            else if (entry) changeExpanded(new Set(expanded.has(entry.path) ? [...expanded].filter((item) => item !== entry.path) : [...expanded, entry.path]));
          }}>
          {renderEntries("")}
        </Tree>
      </div>
    )}
  </div>;
}
