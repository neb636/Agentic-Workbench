import { useContextMenu } from "../../ui/ContextMenu";
import { undo, redo, undoDepth, redoDepth, selectAll } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import { fileSaveHandlers } from "./file-actions";
import { useEffect, useRef, useState } from "react";
import { ToggleButton, ToggleButtonGroup } from "react-aria-components";
import { Compartment, EditorState, Text } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { unifiedMergeView } from "@codemirror/merge";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import type { DiffBase, FileContent, FileViewState } from "../../../shared/models";
import { errorMessage } from "../../core/errors";
import { fileBuffers, isViewDirty, setViewDirty } from "../../core/dirty-views";
import type { ViewComponentProps } from "../../core/view-registry";
import { watchWorkspace } from "../../core/workspace-watch";
import { useWorkbenchStore } from "../../state/workbench-store";
import { Button } from "../../ui/controls";
import { codeTheme } from "./code-theme";

const PICTURE = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i;
const DIFF_BASES: Record<DiffBase, string> = { head: "Last commit", default: "Default branch" };

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Shown when the file on disk no longer matches what this tab opened (usually an agent edited it). */
type Conflict = { disk: FileContent | null; saving: boolean };

/** A picture from the workspace, shown as a picture. */
function PictureView({ root, path }: { root: string; path: string }) {
  const [src, setSrc] = useState<string>();
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => watchWorkspace(root, (event) => { if (event.paths.includes(path)) setRevision((value) => value + 1); }), [root, path]);
  useEffect(() => {
    let active = true;
    window.workbench.files.image(root, path).then((value) => { if (active) { setSrc(value); setError(""); } })
      .catch((caught: unknown) => { if (active) setError(errorMessage(caught)); });
    return () => { active = false; };
  }, [root, path, revision]);
  return <div className="picture-view">
    {error ? <div className="code-message" role="alert">{error}</div> : src ? <img src={src} alt={path} /> : <div className="code-message">Loading…</div>}
  </div>;
}

/**
 * A file tab you can edit: undo, ⌘F, ⌘S, a dot while unsaved. Agents change files all the time, so a tab without
 * edits reloads by itself, and one with edits asks (Reload / Keep mine) instead of ever saving over a newer file.
 * Diff shows the changes against the last commit or the default branch. Pictures show as pictures.
 * Views like this have no session: they are only persisted UI state.
 */
export function FileView(props: ViewComponentProps) {
  const { root, path } = props.view.state as FileViewState;
  // A view ID survives filesystem moves. Reload the editor at its new location before displaying text.
  return <FileEditor key={JSON.stringify([root, path])} {...props} />;
}

function FileEditor({ view, workspace }: ViewComponentProps) {
  const menu = useContextMenu("Editor actions");
  const state = (view.state ?? {}) as FileViewState;
  const { root, path } = state;
  const diffBase: DiffBase = state.diffBase ?? "head";
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorView | null>(null);
  const language = useRef(new Compartment());
  const merge = useRef(new Compartment());
  const readOnly = useRef(new Compartment());
  const saved = useRef<Text>(Text.empty);
  const baseHash = useRef<string | null>(null);
  /** The file couldn't be read, so the tab shows edits kept from before it was hidden. */
  const missing = useRef(false);
  const previewRef = useRef(state.preview);
  previewRef.current = state.preview;
  const [file, setFile] = useState<FileContent>();
  const [error, setError] = useState("");
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState<Conflict>();
  const [notice, setNotice] = useState("");
  const [original, setOriginal] = useState<string | null | undefined>(undefined);
  const picture = PICTURE.test(path);
  const update = (patch: Partial<FileViewState>) => useWorkbenchStore.getState().updateViewState(workspace.id, view.id, patch);
  const markDirty = (value: boolean) => { setDirty(value); setViewDirty(view.id, value); };

  // Load once per file; later disk changes go through the watcher below.
  useEffect(() => {
    if (picture) return;
    let active = true;
    window.workbench.files.read(root, path).then((content) => {
      if (!active) return;
      missing.current = false; setFile(content); setError(""); setConflict(undefined); baseHash.current = content.hash;
    }).catch((e: unknown) => {
      if (!active) return;
      // Gone from disk while the tab was hidden with edits: bring the edits back and say the file is gone.
      const kept = fileBuffers.get(view.id);
      if (!kept) { setError(errorMessage(e)); return; }
      missing.current = true;
      setFile({ path, content: kept.saved, size: new Blob([kept.saved]).size, truncated: false, binary: false, hash: kept.hash ?? "" });
      setConflict({ disk: null, saving: false });
    });
    return () => { active = false; };
  }, [root, path, picture, view.id]);

  const replaceDoc = (content: FileContent) => {
    const editor = editorRef.current;
    baseHash.current = content.hash;
    saved.current = Text.of(content.content.split(/\r?\n/));
    if (!editor) return;
    const head = Math.min(editor.state.selection.main.head, content.content.length);
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: content.content }, selection: { anchor: head } });
    markDirty(false);
  };

  const save = async (force = false) => {
    const editor = editorRef.current;
    if (!editor || file?.truncated) return;
    const doc = editor.state.doc;
    const text = doc.toString();
    const expected = force && conflict ? conflict.disk?.hash ?? null : baseHash.current;
    setNotice("Saving…");
    try {
      const result = await window.workbench.files.write(root, path, text, expected);
      if (result.ok) {
        baseHash.current = result.hash;
        saved.current = doc;
        if (editorRef.current === editor) { markDirty(!editor.state.doc.eq(doc)); fileBuffers.delete(view.id); }
        else {
          // The tab was left before the save finished: its newer edits wait in the buffer, now against this version.
          const kept = fileBuffers.get(view.id);
          if (!kept || kept.text === text) { fileBuffers.delete(view.id); setViewDirty(view.id, false); }
          else fileBuffers.set(view.id, { ...kept, saved: text, hash: result.hash });
        }
        setConflict(undefined);
        setNotice("Saved");
        if (previewRef.current) update({ preview: false });
      } else {
        setConflict({ disk: result.disk, saving: true });
        setNotice("");
      }
    } catch (caught) { setNotice(errorMessage(caught)); }
  };
  useEffect(() => {
    fileSaveHandlers.set(view.id, async () => { await saveRef.current(); return !isViewDirty(view.id); });
    return () => { fileSaveHandlers.delete(view.id); };
  }, [view.id]);
  const saveRef = useRef(save);
  saveRef.current = save;

  // Something else changed the file: reload a clean tab, ask on one with edits.
  useEffect(() => {
    if (picture) return;
    let active = true;
    const off = watchWorkspace(root, (event) => {
      if (!event.paths.some((changed) => changed === path || changed === "")) return;
      void window.workbench.files.read(root, path).then((content) => {
        if (!active || content.hash === baseHash.current) return;
        const editor = editorRef.current;
        if (!editor || editor.state.doc.eq(saved.current)) {
          if (editor) replaceDoc(content); else setFile(content);
          setConflict(undefined);
        } else setConflict({ disk: content, saving: false });
      }).catch(() => { if (active) setConflict({ disk: null, saving: false }); });
    });
    return () => { active = false; off(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, path, picture]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !file || file.binary) return;
    saved.current = Text.of(file.content.split(/\r?\n/));
    // Edits made before this tab was last hidden come back (the editor doesn't outlive its tab).
    const kept = fileBuffers.get(view.id);
    if (kept) {
      saved.current = Text.of(kept.saved.split(/\r?\n/));
      baseHash.current = kept.hash;
      markDirty(true);
      // The file changed on disk while the tab was away: ask, as when it changes on screen.
      if (!missing.current && kept.hash !== file.hash) setConflict({ disk: file, saving: false });
    }
    const editor = new EditorView({
      parent: host,
      state: EditorState.create({ doc: kept?.text ?? file.content, extensions: [
        lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(), drawSelection(), history(), search({ top: true }), highlightSelectionMatches(),
        keymap.of([{ key: "Mod-s", preventDefault: true, run: () => { void saveRef.current(); return true; } }, ...searchKeymap, ...historyKeymap, indentWithTab, ...defaultKeymap]),
        readOnly.current.of(EditorState.readOnly.of(file.truncated)),
        codeTheme, language.current.of([]), merge.current.of([]),
        EditorView.updateListener.of((change) => {
          if (change.docChanged) {
            const isDirty = !change.state.doc.eq(saved.current);
            markDirty(isDirty);
            // Typing keeps a preview tab.
            if (isDirty && previewRef.current) update({ preview: false });
          }
          if (!change.selectionSet) return;
          const head = change.state.selection.main.head;
          const line = change.state.doc.lineAt(head);
          setCursor({ line: line.number, column: head - line.from + 1 });
        }),
      ] }),
    });
    editorRef.current = editor;
    const description = LanguageDescription.matchFilename(languages, path.split("/").at(-1) ?? path);
    let active = true;
    void description?.load().then((support) => { if (active) editor.dispatch({ effects: language.current.reconfigure(support) }); });
    return () => {
      active = false;
      if (editor.state.doc.eq(saved.current)) fileBuffers.delete(view.id);
      else fileBuffers.set(view.id, { text: editor.state.doc.toString(), saved: saved.current.toString(), hash: baseHash.current });
      editor.destroy(); editorRef.current = null;
    };
    // The editor is made once per opened file; reloads replace its text in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file === undefined, file?.binary, path]);

  // Diff: what changed against the last commit or the default branch, shown in the same (still editable) editor.
  useEffect(() => {
    if (!state.diff || picture) { setOriginal(undefined); return; }
    let active = true;
    setOriginal(undefined);
    window.workbench.sourceControl.fileAt(root, path, diffBase).then((text) => { if (active) setOriginal(text); })
      .catch((caught: unknown) => { if (active) { setOriginal(null); setNotice(errorMessage(caught)); } });
    return () => { active = false; };
  }, [state.diff, diffBase, root, path, picture]);
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.dispatch({ effects: merge.current.reconfigure(state.diff && original !== undefined
      ? unifiedMergeView({ original: original ?? "", mergeControls: false, gutter: true, collapseUnchanged: { margin: 3, minSize: 8 } }) : []) });
  }, [state.diff, original, file]);

  // Open at a line (a path:line in an agent's output, a search match).
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !state.line) return;
    const line = editor.state.doc.line(Math.min(Math.max(1, state.line), editor.state.doc.lines));
    editor.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: "center" }) });
    editor.focus();
  }, [state.line, state.lineNonce, file]);

  const segments = path.split("/");
  const badge = file?.truncated ? "Read-only (over 2 MB)" : state.preview ? "Preview" : dirty ? "Unsaved" : "";
  return <section className="file-view" aria-label={`File ${path}`}>
    {menu.overlay}
    <div className="code-card">
      <div className="code-breadcrumbs">
        <nav aria-label="File path">{segments.map((segment, index) => <span key={`${segment}-${index}`} className={index === segments.length - 1 ? "is-current" : ""}>{segment}</span>)}</nav>
        {badge && <span className={`code-badge ${dirty ? "is-dirty" : ""}`}>{badge}</span>}
        {!picture && <span className="code-actions">
          <ToggleButton className="code-tool" isSelected={Boolean(state.diff)} onChange={(diff) => update({ diff })}>Diff</ToggleButton>
          {state.diff && <ToggleButtonGroup aria-label="Compare with" className="segmented code-segmented" selectionMode="single" disallowEmptySelection
            selectedKeys={[diffBase]} onSelectionChange={(keys) => { const key = [...keys][0]; if (key) update({ diffBase: key as DiffBase }); }}>
            {(Object.keys(DIFF_BASES) as DiffBase[]).map((base) => <ToggleButton key={base} id={base} className="segment">{DIFF_BASES[base]}</ToggleButton>)}
          </ToggleButtonGroup>}
          <Button className="code-tool" isDisabled={!dirty || file?.truncated} onPress={() => void save()}>Save</Button>
        </span>}
      </div>
      {conflict && <div className="code-conflict" role="alert">
        <span>{conflict.disk === null ? "This file was deleted or can't be read on disk." : conflict.saving ? "Not saved: the file changed on disk since you opened it." : "Changed on disk while you were editing."}</span>
        {conflict.disk && <Button className="code-tool" onPress={() => { replaceDoc(conflict.disk!); setConflict(undefined); setNotice("Reloaded from disk"); }}>Reload (lose my edits)</Button>}
        <Button className="code-tool" onPress={() => { void save(true); }}>Keep mine and save</Button>
        {!conflict.saving && <Button className="code-tool" onPress={() => { if (conflict.disk) baseHash.current = conflict.disk.hash; setConflict(undefined); }}>Keep mine</Button>}
      </div>}
      {picture ? <PictureView root={root} path={path} />
        : error ? <div className="code-message" role="alert">{error}</div>
          : file?.binary ? <div className="code-message">This file looks binary, so it is not shown.</div>
            : <div className="code-editor" ref={hostRef} {...menu.bind(() => {
          const editor = editorRef.current;
          if (!editor) return [];
          const writable = !file?.truncated && !editor.state.readOnly;
          const selected = editor.state.sliceDoc(editor.state.selection.main.from, editor.state.selection.main.to);
          const replace = (text: string) => { editor.focus(); editor.dispatch(editor.state.replaceSelection(text)); };
          return [
            { id: "undo", label: "Undo", disabled: !writable || !undoDepth(editor.state), run: () => { undo(editor); } },
            { id: "redo", label: "Redo", disabled: !writable || !redoDepth(editor.state), run: () => { redo(editor); } },
            { id: "cut", label: "Cut", disabled: !writable || !selected, section: "clipboard", run: async () => { await navigator.clipboard.writeText(selected); replace(""); } },
            { id: "copy", label: "Copy", disabled: !selected, section: "clipboard", run: () => navigator.clipboard.writeText(selected) },
            { id: "paste", label: "Paste", disabled: !writable, section: "clipboard", run: async () => replace(await navigator.clipboard.readText()) },
            { id: "select-all", label: "Select All", section: "selection", run: () => { selectAll(editor); } },
            { id: "find", label: "Find…", section: "search", run: () => { openSearchPanel(editor); } },
            { id: "replace", label: "Replace…", disabled: !writable, section: "search", run: () => { openSearchPanel(editor); requestAnimationFrame(() => hostRef.current?.querySelector<HTMLInputElement>('input[name="replace"]')?.focus()); } },
            { id: "save", label: "Save", disabled: !writable || !dirty, section: "save", run: () => save() },
          ];
        })} />}
      <div className="code-footer">
        <span>Ln {cursor.line}, Col {cursor.column} · LF · UTF-8{state.diff ? ` · diff vs ${DIFF_BASES[diffBase].toLowerCase()}${original === null ? " (new file)" : ""}` : ""}</span>
        <span>{notice && <span className="code-notice">{notice} · </span>}{file ? `${formatSize(file.size)}${file.truncated ? " · showing the first 2 MB" : ""}` : picture ? "Picture" : "Loading…"}</span>
      </div>
    </div>
  </section>;
}
