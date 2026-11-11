import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { unifiedMergeView } from "@codemirror/merge";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";
import type { CommitFileViewState, SourceControlCommitFileContents } from "../../../shared/models";
import { errorMessage } from "../../core/errors";
import type { ViewComponentProps } from "../../core/view-registry";
import { codeTheme } from "../files/code-theme";

/** Read-only: what one commit did to one file. Views like this have no session. */
export function CommitFileView({ view }: ViewComponentProps) {
  const { root, commitId, shortId, path, originalPath, subject, reloaded } = view.state as CommitFileViewState;
  const hostRef = useRef<HTMLDivElement>(null);
  const [contents, setContents] = useState<SourceControlCommitFileContents>();
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setContents(undefined); setError("");
    window.workbench.sourceControl.commitFile(root, commitId, path, originalPath)
      .then((value) => { if (active) setContents(value); })
      .catch((caught: unknown) => { if (active) setError(errorMessage(caught)); });
    return () => { active = false; };
  }, [root, commitId, path, originalPath, reloaded]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !contents || contents.binary) return;
    const language = new Compartment();
    const editor = new EditorView({
      parent: host,
      state: EditorState.create({ doc: contents.after ?? "", extensions: [
        lineNumbers(), EditorState.readOnly.of(true), EditorView.editable.of(false), codeTheme, language.of([]),
        unifiedMergeView({ original: contents.before ?? "", mergeControls: false, gutter: true, collapseUnchanged: { margin: 3, minSize: 8 } }),
      ] }),
    });
    const description = LanguageDescription.matchFilename(languages, path.split("/").at(-1) ?? path);
    let active = true;
    void description?.load().then((support) => { if (active) editor.dispatch({ effects: language.reconfigure(support) }); });
    return () => { active = false; editor.destroy(); };
  }, [contents, path]);

  const segments = path.split("/");
  const change = contents?.before === null ? " · added" : contents?.after === null ? " · deleted" : originalPath ? ` · renamed from ${originalPath}` : "";
  return <section className="file-view" aria-label={`${path} at commit ${shortId}`}>
    <div className="code-card">
      <div className="code-breadcrumbs">
        <nav aria-label="File path">{segments.map((segment, index) => <span key={`${segment}-${index}`} className={index === segments.length - 1 ? "is-current" : ""}>{segment}</span>)}</nav>
        <span className="code-badge">{shortId}</span>
      </div>
      {error ? <div className="code-message" role="alert">{error}</div>
        : !contents ? <div className="code-message">Loading…</div>
          : contents.binary ? <div className="code-message">This file looks binary, so it is not shown.</div>
            : <div className="code-editor-frame"><div className="code-editor" ref={hostRef} /></div>}
      <div className="code-footer">
        <span>{subject}{change}</span>
        <span>{contents?.truncated ? "Showing the first 2 MB" : "Read-only"}</span>
      </div>
    </div>
  </section>;
}
