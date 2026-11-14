import type { FileLocation } from "../../../shared/file-operations";
import { useContextMenu, type ContextAction } from "../../ui/ContextMenu";
import { useChoiceDialog } from "../../ui/ChoiceDialog";
import { locationActions, operateFiles, useFileActions, refreshFileHistory } from "./file-actions";
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
import { ChevronRightIcon, CloseIcon, FileIcon, FolderIcon, PlusIcon, RefreshIcon, SearchIcon } from "../../ui/icons";
import { type FileSearchMode, useExplorerRequests } from "../explorer/explorer-store";
import { CHANGE_LETTERS, useSourceControlStatus } from "../source-control/source-control-store";

type Listing = FileEntry[] | { error: string };

const parentOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const ancestorsOf = (path: string) => path.split("/").slice(0, -1).map((_, index, parts) => parts.slice(0, index + 1).join("/"));


/** A name typed for a new file or folder, or a rename. */
function NameForm({ title, initial, onSubmit, onCancel, busy }: { busy: boolean; title: string; initial: string; onSubmit: (name: string) => Promise<void>; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState("");
  return <form className="file-name-form" onSubmit={(event) => {
    event.preventDefault();
    if (busy || !value.trim()) return;
    void onSubmit(value.trim()).catch((caught: unknown) => setError(errorMessage(caught)));
  }}>
    <TextField value={value} onChange={setValue} isDisabled={busy} autoFocus onKeyDown={(event) => { if (event.key === "Escape") onCancel(); }}>
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
  const reveal = useExplorerRequests((state) => state.reveal);
  const root = reveal?.workspaceId === workspace.id ? reveal.root : workspace.path;
  const menu = useContextMenu("File actions");
  const { choose, dialog } = useChoiceDialog();
  const [selected, setSelected] = useState<Set<Key>>(new Set());
  const [scope, setScope] = useState<string>();
  const fileActions = useFileActions();
  useEffect(() => { void refreshFileHistory(); }, []);
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

  useEffect(() => { setListings({}); setExpanded(new Set()); setSelected(new Set()); setScope(undefined); load(""); loadIgnored(); }, [load, loadIgnored]);
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
    setScope(request.directory);
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
      void window.workbench.files.search(root, text, { caseSensitive, regex, directory: scope })
        .then((result) => { if (active) setContents(result); })
        .catch((caught: unknown) => { if (active) setContents({ matches: [], limited: false, error: errorMessage(caught) }); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [root, query, mode, caseSensitive, regex, scope]);

  // The file on screen is shown in the tree: its folders open and its row is highlighted.
  useEffect(() => {
    if (!activeFile) return;
    const folders = ancestorsOf(activeFile);
    for (const folder of folders) if (!loaded.current.includes(folder)) load(folder);
    setExpanded((current) => folders.every((folder) => current.has(folder)) ? current : new Set([...current, ...folders]));
    const timer = setTimeout(() => treeRef.current?.querySelector(`[data-path="${CSS.escape(activeFile)}"]`)?.scrollIntoView({ block: "nearest" }), 200);
    return () => clearTimeout(timer);
  }, [activeFile, load]);

  useEffect(() => {
    if (!reveal || reveal.workspaceId !== workspace.id) return;
    setQuery(""); setScope(undefined);
    const folders = ancestorsOf(reveal.path);
    folders.forEach(load); setExpanded((old) => new Set([...old, ...folders])); setSelected(new Set([reveal.path]));
    const timer = setTimeout(() => treeRef.current?.querySelector(`[data-path="${CSS.escape(reveal.path)}"]`)?.scrollIntoView({ block: "nearest" }), 250);
    return () => clearTimeout(timer);
  }, [reveal, workspace.id, load]);
  useEffect(() => {
    const changed = (event: Event) => {
      const effects = (event as CustomEvent<import("../../../shared/file-operations").FileEffect[]>).detail;
      const remap = (value: string) => {
        for (const effect of effects) if (effect.source?.root === root && (value === effect.source.path || value.startsWith(`${effect.source.path}/`))) {
          return effect.target?.root === root ? effect.target.path + value.slice(effect.source.path.length) : undefined;
        }
        return value;
      };
      setExpanded((keys) => new Set([...keys].map((key) => remap(String(key))).filter((key): key is string => key !== undefined)));
      setSelected((keys) => new Set([...keys].map((key) => remap(String(key))).filter((key): key is string => key !== undefined)));
      loaded.current.forEach(load); loadIgnored();
    };
    window.addEventListener("workbench:file-effects", changed); return () => window.removeEventListener("workbench:file-effects", changed);
  }, [root, load, loadIgnored]);

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
  const locationsFor = (entry?: FileEntry): FileLocation[] => {
    const paths = entry && selected.has(entry.path) ? [...selected].map(String) : entry ? [entry.path] : [];
    return paths.filter((path) => !paths.some((parent) => parent !== path && path.startsWith(`${parent}/`))).map((path) => ({ root, path }));
  };
  const paste = async (folder: string) => {
    const clipboard = useFileActions.getState().clipboard;
    if (!clipboard?.paths.length) return;
    const entries = await window.workbench.files.list(root, folder);
    const collision = clipboard.paths.some((p) => entries.some((e) => e.name === p.path.split("/").at(-1)));
    let policy: "error" | "keep-both" | "skip" = "error";
    if (collision) {
      const choice = await choose("Files already exist", "Choose how to handle existing names. Existing files are never overwritten.", ["Keep Both", "Skip", "Cancel"]);
      if (choice === "Cancel") return;
      policy = choice === "Keep Both" ? "keep-both" : "skip";
    }
    await operateFiles({ kind: "transfer", sources: clipboard.paths, destination: { root, path: folder }, move: clipboard.cut, collision: policy });
  };
  const actionsFor = (entry?: FileEntry): ContextAction[] => {
    const location = { root, path: entry?.path ?? "" }, directory = !entry || entry.kind === "directory";
    const folder = directory ? location.path : parentOf(location.path);
    const paths = locationsFor(entry), multiple = paths.length > 1;
    const busy = fileActions.busy;
    const actions: ContextAction[] = [
      ...(!multiple ? locationActions(workspace, location, directory).filter((a) => a.id !== "reveal-files" && (entry || a.id !== "copy-relative")) : [
        { id: "copy-absolute", label: "Copy Paths", section: "paths", run: async () => navigator.clipboard.writeText((await Promise.all(paths.map((p) => window.workbench.files.locate(p.root, p.path)))).join("\n")) },
        { id: "copy-relative", label: "Copy Relative Paths", section: "paths", run: () => navigator.clipboard.writeText(paths.map((p) => p.path).join("\n")) },
      ]),
      ...(!multiple ? [
        { id: "new-file", label: "New File…", section: "create", run: () => setForm({ kind: "file", path: folder }) },
        { id: "new-folder", label: "New Folder…", section: "create", run: () => setForm({ kind: "directory", path: folder }) },
        ...(directory ? [{ id: "find-folder", label: "Find in Folder…", section: "create", run: () => { setScope(folder || undefined); setMode("contents"); searchRef.current?.focus(); } }] : []),
      ] : []),
      ...(entry ? [
        { id: "cut", label: "Cut", section: "clipboard", run: () => useFileActions.setState({ clipboard: { paths, cut: true } }) },
        { id: "copy", label: "Copy", section: "clipboard", run: () => useFileActions.setState({ clipboard: { paths, cut: false } }) },
        { id: "duplicate", label: "Duplicate", section: "clipboard", run: () => operateFiles({ kind: "duplicate", sources: paths }) },
      ] : []),
      ...(!multiple ? [{ id: "paste", label: "Paste", section: "clipboard", disabled: !fileActions.clipboard?.paths.length, run: () => paste(folder) }] : []),
      ...(entry && !multiple ? [{ id: "rename", label: "Rename…", section: "manage", run: () => setForm({ kind: "rename", path: entry.path }) }] : []),
      { id: "undo", label: fileActions.history.undo ? `Undo ${fileActions.history.undo}` : "Undo", disabled: !fileActions.history.undo, section: "history", run: () => operateFiles({ kind: "undo" }) },
      { id: "redo", label: fileActions.history.redo ? `Redo ${fileActions.history.redo}` : "Redo", disabled: !fileActions.history.redo, section: "history", run: () => operateFiles({ kind: "redo" }) },
      ...(entry ? [{ id: "trash", label: multiple ? `Move ${paths.length} Items to Trash…` : "Move to Trash…", section: "trash", destructive: true, run: async () => {
        if (await choose("Move to Trash?", "Selected files and folder contents will move to system Trash. Restore them through your system file manager; DimSum's Undo does not restore Trash.", ["Cancel", "Move to Trash"]) === "Move to Trash") await operateFiles({ kind: "trash", sources: paths });
      } }] : [
        { id: "refresh", label: "Refresh", section: "tree", run: () => { Object.keys(listings).forEach(load); loadIgnored(); } },
        { id: "collapse", label: "Collapse All", section: "tree", run: () => setExpanded(new Set()) },
      ]),
    ];
    const mod = window.workbench.platform === "darwin" ? "⌘" : "Ctrl+";
    const shortcuts: Record<string, string> = { cut: `${mod}X`, copy: `${mod}C`, paste: `${mod}V`, undo: `${mod}Z`, redo: window.workbench.platform === "darwin" ? "⇧⌘Z" : "Ctrl+Shift+Z" };
    return actions.map((a) => ({ ...a, shortcut: shortcuts[a.id], disabled: busy || a.disabled }));
  };
  const searchActions = (path: string, line?: number, text?: string): ContextAction[] => [
    ...locationActions(workspace, { root, path }, false, true, line),
    ...(text !== undefined ? [
      { id: "copy-match", label: "Copy Match", run: () => navigator.clipboard.writeText(text) },
      { id: "copy-line", label: "Copy Path with Line", run: async () => navigator.clipboard.writeText(`${await window.workbench.files.locate(root, path)}:${line}`) },
    ] : []),
  ];
  const submitForm = async (name: string) => {
    if (!form) return;
    if (form.kind === "rename" && /[\\/]/.test(name)) throw new Error("Use a name, not a path.");
    if (form.kind === "rename") {
      const target = parentOf(form.path) ? `${parentOf(form.path)}/${name}` : name;
      await operateFiles({ kind: "rename", source: { root, path: form.path }, target: { root, path: target } });
      load(parentOf(form.path));
    } else {
      const target = form.path ? `${form.path}/${name}` : name;
      await operateFiles({ kind: "create", target: { root, path: target }, entryKind: form.kind });
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
      const classes = ["file-tree-item", fileActions.clipboard?.cut && fileActions.clipboard.paths.some((p) => p.root === root && p.path === entry.path) && "is-cut", isIgnored(entry.path) && "is-ignored", activeFile === entry.path && "is-current"].filter(Boolean).join(" ");
      return <TreeItem key={entry.path} id={entry.path} textValue={entry.name} className={classes} {...menu.bind(() => actionsFor(entry), () => { if (!selected.has(entry.path)) setSelected(new Set([entry.path])); })} hasChildItems={entry.kind === "directory"}>
        <TreeItemContent>
          {({ level, isExpanded }) => <div className="file-tree-row" data-path={entry.path} style={{ paddingInlineStart: 6 + (level - 1) * 14 }}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || (event.target as HTMLElement).closest("button")) return;
              if (entry.kind === "file") open(entry.path);
              else changeExpanded(new Set(expanded.has(entry.path) ? [...expanded].filter((item) => item !== entry.path) : [...expanded, entry.path]));
            }}
            onDoubleClick={() => { if (entry.kind === "file") open(entry.path, { preview: false }); }}>
            {entry.kind === "directory"
              ? <AriaButton slot="chevron" className={`tree-chevron ${isExpanded ? "is-expanded" : ""}`} aria-label={isExpanded ? `Collapse ${entry.name}` : `Expand ${entry.name}`}><ChevronRightIcon size={12} /></AriaButton>
              : <span className="tree-chevron-spacer" />}
            {entry.kind === "directory" ? <FolderIcon size={14} /> : <FileIcon size={14} />}
            <span className="file-tree-name">{entry.name}</span>
            {kind ? <span className={`change-letter kind-${kind}`} title={kind}>{CHANGE_LETTERS[kind]}</span>
              : entry.kind === "directory" && marks.folders.has(entry.path) ? <span className="change-dot" title="Has changes" /> : null}
            {menu.overflow(actionsFor(entry), entry.name)}
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

  return <div className="side-panel files-panel" onKeyDown={(event) => {
    if ((event.target as HTMLElement).closest("input, textarea, [contenteditable], [role=menu]")) return;
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      menu.bind((target) => {
        const row = target.closest<HTMLElement>("[data-file-context]");
        if (!row?.dataset.fileContext) return [];
        const path = row.dataset.fileContext;
        return searchActions(path, Number(row.dataset.matchLine) || undefined, row.dataset.matchText);
      }).onKeyDown(event);
      return;
    }
    if (!(event.metaKey || event.ctrlKey)) return;
    const entry = selected.size ? entryFor(String([...selected][0])) : undefined;
    const key = event.key.toLowerCase();
    const action = key === "z" ? event.shiftKey ? "redo" : "undo" : key === "c" ? "copy" : key === "x" ? "cut" : key === "v" ? "paste" : "";
    const item = actionsFor(entry).find((a) => a.id === action);
    if (item && !item.disabled) { event.preventDefault(); void Promise.resolve(item.run()).catch((error: unknown) => setNotice(String(error))); }
  }}>
    {menu.overlay}{dialog}
    <div className="side-panel-header" {...menu.bind(() => actionsFor())}>
      <h2 title={root}>{root === workspace.path ? workspace.name : root.split(/[\\/]/).at(-1)}</h2>
      <span className="header-actions">
        <IconButton isDisabled={fileActions.busy} label="New file at the top" onPress={() => setForm({ kind: "file", path: "" })}><PlusIcon size={14} /></IconButton>
        {menu.overflow(actionsFor(), "Workspace files")}
        <IconButton label="Refresh files" onPress={() => { Object.keys(listings).forEach(load); loadIgnored(); }}><RefreshIcon size={14} /></IconButton>
      </span>
    </div>
    {root !== workspace.path && <AriaButton className="panel-note" onPress={() => useExplorerRequests.setState({ reveal: { workspaceId: workspace.id, root: workspace.path, path: "", nonce: Date.now() } })}>Back to workspace folder</AriaButton>}
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
    {scope && <div className="file-search-scope"><span title={scope}>In {scope}</span><IconButton label="Clear search scope" onPress={() => setScope(undefined)}><CloseIcon size={12} /></IconButton></div>}
    {form && <NameForm busy={fileActions.busy} key={`${form.kind}:${form.path}`} title={form.kind === "rename" ? `Rename ${form.path}` : `New ${form.kind === "file" ? "file" : "folder"} in ${form.path || "the top folder"}`}
      initial={form.kind === "rename" ? form.path.split("/").at(-1) ?? "" : ""} onSubmit={submitForm} onCancel={() => setForm(undefined)} />}
    {fileActions.notice && <p className="panel-note file-operation-note" role="status">{fileActions.notice}</p>}
    {notice && <p className="panel-note" role="status">{notice}</p>}
    {names ? (
      <GridList aria-label="Matching files" className="panel-list" items={names.map((path) => ({ id: path }))} onAction={(key) => open(String(key))}
        renderEmptyState={() => <p className="panel-empty">No files match “{query}”.</p>}>
        {(item) => <GridListItem data-file-context={item.id} id={item.id} textValue={item.id} className="panel-list-item" {...menu.bind(() => searchActions(item.id))}>
          <FileIcon size={14} /><span className="file-tree-name">{item.id.split("/").at(-1)}</span><small>{parentOf(item.id)}</small>{menu.overflow(searchActions(item.id), item.id)}
        </GridListItem>}
      </GridList>
    ) : contents ? (
      <div className="panel-list search-results" aria-label="Matches inside files">
        {contents.error && <p className="panel-empty panel-error" role="alert">{contents.error}</p>}
        {!contents.busy && !contents.error && grouped.length === 0 && <p className="panel-empty">Nothing inside the files matches “{query}”.</p>}
        {grouped.length > 0 && <p className="panel-note">{contents.matches.length}{contents.limited ? "+" : ""} matches in {grouped.length} files{contents.limited ? " (stopped at the limit)" : ""}</p>}
        {grouped.map(([path, lines]) => <Disclosure key={path} defaultExpanded className="search-file">
          <Heading className="search-file-heading">
            <AriaButton slot="trigger" className="search-file-trigger" {...menu.bind(() => locationActions(workspace, { root, path }))}>
              <ChevronRightIcon size={11} /><FileIcon size={13} /><span className="file-tree-name">{path.split("/").at(-1)}</span>
              <small>{parentOf(path)}</small><span className="count-badge">{lines.length}</span>
            </AriaButton>
          </Heading>
          <DisclosurePanel>
            <GridList aria-label={`Matches in ${path}`} className="search-lines" items={lines.map((match) => ({ ...match, id: `${match.line}` }))}
              onAction={(key) => open(path, { line: Number(key) })}>
              {(match) => <GridListItem data-file-context={path} data-match-text={match.text} data-match-line={match.line} id={match.id} textValue={match.text} className="search-line" {...menu.bind(() => searchActions(path, match.line, match.text))}>
                <small>{match.line}</small><code>{match.text.trim()}</code>{menu.overflow(searchActions(path, match.line, match.text), `${path}:${match.line}`)}
              </GridListItem>}
            </GridList>
          </DisclosurePanel>
        </Disclosure>)}
      </div>
    ) : (
      <div ref={treeRef} className="file-tree-scroll" tabIndex={-1} {...menu.bind((target) => actionsFor(entryFor(target.closest("[role=row]")?.getAttribute("data-key") ?? "")))}>
        <Tree aria-label={`Files in ${workspace.name}`} className="file-tree" selectionMode="multiple" selectionBehavior="replace" selectedKeys={selected} onSelectionChange={(keys) => setSelected(keys === "all" ? new Set(Object.values(listings).flatMap((list) => Array.isArray(list) ? list.map((e) => e.path) : [])) : new Set(keys))} expandedKeys={expanded} onExpandedChange={changeExpanded}
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
