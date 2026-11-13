# The workbench

The DimSum window has four parts: the workspaces on the left, the open views in the middle, panels on the right, and a status bar along the bottom.

## Workspaces

The left sidebar lists your workspaces. Each one is a folder, and its agent sessions are listed under it with their status, harness and branch.

Right-click a workspace to create a new view in it, reveal its folder, open it in a terminal, copy its path, give it a custom icon, or remove it. Removing a workspace takes it out of DimSum and leaves the folder alone.

Files you open on their own, from Finder or with <kbd>⌘</kbd><kbd>O</kbd>, are collected under a separate entry that only holds files. The **Settings** button is at the bottom of the sidebar.

## Views and tabs

A view is something open in a tab. DimSum comes with these view types:

| View | What it is |
| --- | --- |
| Agent session | An agent CLI in a terminal, with the composer below it. |
| Terminal | A plain shell in the workspace folder. |
| File | A file open in the editor. Open one from the Files panel. |
| Commit file | A read-only view of how one commit changed a file. Open one from source-control history. |

Extensions can add more view types. Drag tabs to reorder them. When there are more tabs than fit, the rest go into a **+N more** menu. Right-click a tab to close it, the others, the tabs to its right, or all of them. File tabs also offer **Keep open**, copying the path and revealing the file.

## Panels

The right sidebar has an activity bar that switches between panels:

- **Active views**: everything open, across workspaces.
- **Files**: the workspace's files, search and file operations. See [Files and the editor](/guide/files).
- **Source control**: changes, commits, branches and history, with a badge showing how many files changed. See [Source control](/guide/source-control).
- **Extensions**: built-in, personal and workspace extensions. See [Extensions](/extend/).

## Status bar

The left side summarizes the active session. The right side shows the current branch, the [AI usage meter](/guide/ai-usage-resources) and the Resource Manager.

## What DimSum remembers

When you close and reopen the app, it brings back your workspaces, open views, drafts, panel sizes and which panels were open. Agent CLIs and terminals don't keep running after you quit, because closing the app stops the processes it started. The session you were looking at reopens its conversation. Other sessions wait until you click into them, choose **Resume previous…**, or send a prompt.
