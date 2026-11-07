import { useEffect, useState } from "react";
import type { Workspace } from "../../../shared/models";
import { handleLabShare } from "./lab-share";

export interface KnownIssue { title: string; text: string }

/** The open (`- [ ]`) entries of a known-issues.md, each with its indented lines (Check, Code, Ideas). */
export function parseKnownIssues(markdown: string): KnownIssue[] {
  const issues: (KnownIssue & { done: boolean })[] = [];
  let current: (KnownIssue & { done: boolean }) | undefined;
  for (const line of markdown.split("\n")) {
    const item = line.match(/^- \[( |x|X)\] (.*)$/);
    if (item) {
      current = { done: item[1] !== " ", title: (item[2].match(/\*\*(.+?)\*\*/)?.[1] ?? item[2]).replace(/\.$/, "").trim(), text: line };
      issues.push(current);
    } else if (current && /^\s+\S/.test(line)) current.text += `\n${line}`;
    else if (line.trim()) current = undefined;
  }
  return issues.filter((issue) => !issue.done).map(({ title, text }) => ({ title, text }));
}

/** The country's open known issues that link to this activity. */
export function useKnownIssues(workspace: Workspace, place?: string, activity?: string): KnownIssue[] {
  const [issues, setIssues] = useState<KnownIssue[]>([]);
  useEffect(() => {
    let active = true;
    setIssues([]);
    if (!place || !activity) return;
    window.workbench.files.read(workspace.path, `planning/around-the-world/${place}/known-issues.md`)
      .then((file) => { if (active) setIssues(parseKnownIssues(file.content).filter((issue) => issue.text.includes(`#/world/${place}/${activity}`))); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [workspace.path, place, activity]);
  return issues;
}


export function KnownIssuesList({ workspace, issues, onClose }: { workspace: Workspace; issues: KnownIssue[]; onClose: () => void }) {
  const [error, setError] = useState("");
  return <div className="known-issues" role="dialog" aria-label="Known issues for this activity">
    <div className="known-issues-head"><strong>Known issues here</strong><button className="game-tool" onClick={onClose}>Close</button></div>
    {error && <p role="alert">{error}</p>}
    <ul>
      {issues.map((issue) => <li key={issue.title}>
        <details><summary>{issue.title}</summary><pre>{issue.text}</pre></details>
        <button className="game-tool" onClick={() => {
          void handleLabShare(workspace, { action: "agent", label: `Known issue: ${issue.title}`, text: `From known-issues.md (fix it, then tick it off there):\n${issue.text}` }).then(onClose).catch(error => setError(String(error)));
        }}>Send to agent</button>
      </li>)}
    </ul>
  </div>;
}
