import { useEffect, useRef, useState } from "react";
import { Compartment, EditorState, Text } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { unifiedMergeView } from "@codemirror/merge";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import type { DiffBase, FileContent, FileViewState } from "../../../shared/models";
import { errorMessage } from "../../core/errors";
import { fileBuffers, setViewDirty } from "../../core/dirty-views";
import type { ViewComponentProps } from "../../core/view-registry";
import { watchWorkspace } from "../../core/workspace-watch";
import { useWorkbenchStore } from "../../state/workbench-store";
import { codeTheme } from "./code-theme";

const PICTURE = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Shown when the file on disk no longer matches what this tab opened (an agent edited it, usually). */
type Conflict = { disk: FileContent | null; saving: boolean };

/** A picture from the checkout (sprites, contact sheets in qa-output/), shown as a picture. */
function PictureView({ root, path }: { root: string; path: string }) {
  const [src, setSrc] = useState<string>();
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => watchWorkspace(root, (event) => { if (event.paths.includes(path)) setRevision((value) => value + 1); }), [root, path]);
  useEffect(() => {
    let active = true;
    window.workbench.files.image(root, path).then((value) => { if (active) { setSrc(value); setError(""); } }).catch((caught) => { if (active) setError(errorMessage(caught)); });
    return () => { active = false; };
  }, [root, path, revision]);
  return <div className="picture-view">
    {error ? <div className="code-message" role="alert">{error}</div> : src ? <img src={src} alt={path} /> : <div className="code-message">Loading…</div>}
  </div>;
}

/**
 * A file tab you can edit: undo, ⌘F, ⌘S, a dot while unsaved. Agents change files all the time, so a tab without
 * edits reloads by itself, and one with edits asks (Reload / Keep mine) instead of ever saving over a newer file.
 * ⇄ shows the changes against the last commit or main. Pictures show as pictures.
 */
export function FileView({ view, workspace }: ViewComponentProps) {
  const state = (view.state ?? {}) as FileViewState;
  const { root, path } = state;
  const repoRoot = useWorkbenchStore((store) => store.repoRoot);
  const isMain = !repoRoot || repoRoot.replace(/\/+$/, "") === workspace.path.replace(/\/+$/, "");
  const diffBase: DiffBase = state.diffBase ?? (isMain ? "head" : "main");
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorView | null>(null);
  const language = useRef(new Compartment());
  const merge = useRef(new Compartment());
  const readOnly = useRef(new Compartment());
  const saved = useRef<Text>(Text.empty);
  const baseHash = useRef<string | null>(null);
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
      setFile(content); setError(""); baseHash.current = content.hash;
    }).catch((e: unknown) => { if (active) setError(errorMessage(e)); });
    return () => { active = false; };
  }, [root, path, picture]);

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
  const saveRef = useRef(save);
  saveRef.current = save;

  // An agent (or anything else) changed the file: reload a clean tab, ask on one with edits.
  useEffect(() => {
    if (picture) return;
    return watchWorkspace(root, (event) => {
      if (!event.paths.some((changed) => changed === path || changed === "")) return;
      void window.workbench.files.read(root, path).then((content) => {
        if (content.hash === baseHash.current) return;
        const editor = editorRef.current;
        if (!editor || editor.state.doc.eq(saved.current)) { if (editor) replaceDoc(content); else setFile(content); setConflict(undefined); }
        else setConflict({ disk: content, saving: false });
      }).catch(() => setConflict({ disk: null, saving: false }));
    });
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
      if (kept.hash !== file.hash) setConflict({ disk: file, saving: false });
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

  // ⇄ Diff: what changed against the last commit or main, shown in the same editor (still editable).
  useEffect(() => {
    if (!state.diff || picture) { setOriginal(undefined); return; }
    let active = true;
    setOriginal(undefined);
    window.workbench.sourceControl.fileAt(root, path, diffBase).then((text) => { if (active) setOriginal(text); })
      .catch((caught) => { if (active) { setOriginal(null); setNotice(errorMessage(caught)); } });
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
    <div className="code-card">
      <div className="code-breadcrumbs">
        <nav aria-label="File path">{segments.map((segment, index) => <span key={`${segment}-${index}`} className={index === segments.length - 1 ? "is-current" : ""}>{segment}</span>)}</nav>
        {badge && <span className={`code-badge ${dirty ? "is-dirty" : ""}`}>{badge}</span>}
        {!picture && <span className="code-actions">
          <button className={`lab-toggle ${state.diff ? "is-on" : ""}`} aria-pressed={Boolean(state.diff)} title="Show what changed" onClick={() => update({ diff: !state.diff })}>⇄ Diff</button>
          {state.diff && <select aria-label="Compare with" value={diffBase} onChange={(event) => update({ diffBase: event.target.value as DiffBase })}>
            <option value="main">vs main (the PR)</option>
            <option value="head">vs last commit</option>
          </select>}
          <button className="game-tool" disabled={!dirty || file?.truncated} title="Save (⌘S)" onClick={() => void save()}>Save</button>
        </span>}
      </div>
      {conflict && <div className="code-conflict" role="alert">
        <span>{conflict.disk === null ? "This file was deleted or can't be read on disk." : conflict.saving ? "Not saved: the file changed on disk since you opened it." : "Changed on disk while you were editing."}</span>
        {conflict.disk && <button className="game-tool" onClick={() => { replaceDoc(conflict.disk!); setConflict(undefined); setNotice("Reloaded from disk"); }}>Reload (lose my edits)</button>}
        <button className="game-tool" onClick={() => { void save(true); }}>Keep mine and save</button>
        {!conflict.saving && <button className="game-tool" onClick={() => { if (conflict.disk) baseHash.current = conflict.disk.hash; setConflict(undefined); }}>Keep mine</button>}
      </div>}
      {picture ? <PictureView root={root} path={path} />
        : error ? <div className="code-message" role="alert">{error}</div>
        : file?.binary ? <div className="code-message">This file looks binary, so it is not shown.</div>
          : <div className="code-editor" ref={hostRef} />}
      <div className="code-footer">
        <span>Ln {cursor.line}, Col {cursor.column} · LF · UTF-8{state.diff ? ` · diff ${diffBase === "main" ? "vs main" : "vs last commit"}${original === null ? " (new file)" : ""}` : ""}</span>
        <span>{notice && <span className="code-notice">{notice} · </span>}{file ? `${formatSize(file.size)}${file.truncated ? " · showing the first 2 MB" : ""}` : picture ? "Picture" : "Loading…"}</span>
      </div>
    </div>
  </section>;
}
