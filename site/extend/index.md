# Extensions

An extension is a TypeScript file that adds to DimSum. You write it in the workspace or in your own `~/.dimsum` folder, and the app loads it as soon as you save it, or any file it imports. You don't need to build, install or restart anything.

DimSum's own features use the same API, so an extension can do what the built-in panels and menus do.

## What an extension can add

- **Views**: new tab types in the + menu, such as a level editor or a dashboard.
- **Panels**: new sections in the right sidebar.
- **Widgets** in the status bar, the sidebar, the composer toolbar or Settings.
- **Composer menus**: toggles, choices and text fields that add to the prompt, like [instructions](/guide/personas-instructions#instructions).
- **Prompt contributors**: text added to every prompt.
- **Context menu items** for workspaces, views, files and selected text.
- **Send checks**: guards that warn about a prompt, or block it, before it is sent.
- **Commands and events**: run the app's commands and react when views open, close or change status.
- **Workspace files**: read and write text files in the workspace.
- **Local previews**: show a page from a development server on your machine (`127.0.0.1` or `localhost`) inside a view, and exchange messages with it. See [Showing a local page](/extend/sdk#showing-a-local-page).

## Where extensions live

| Folder | Who it is for | Runs |
| --- | --- | --- |
| `<workspace>/.dimsum/extensions/<name>/index.tsx` | Everyone who works in the workspace. Check it in. | Only after you [trust the workspace](/guide/trust). |
| `~/.dimsum/extensions/<name>/index.tsx` | You, in every workspace. | Always. |

A workspace extension's contributions appear only in its own workspace, and its section in Settings shows while that workspace is the active one. Two worktrees of the same repository each run their own copy.

## The Extensions panel

The Extensions panel in the right sidebar lists **Built in**, **Yours everywhere** and the workspace's own extensions. From it you can:

- turn any extension on or off, which is saved in [`settings.json`](/configure/config-files#settings-json). Your own extensions are turned off in `~/.dimsum/settings.json`, which covers every workspace;
- **Trust workspace**, to let its extensions run;
- **Reload extensions**;
- create a **New workspace extension**. See [Your first extension](/extend/first-extension).

## When something goes wrong

- If an extension's `activate` throws, nothing it registered stays behind, and the panel shows the error.
- A view that fails while rendering shows its error in place. The rest of the app keeps working.
- A save that doesn't compile is reported, and the last version that compiled keeps running.

## The status file

After every build and activation, DimSum writes `.status.json` into the extension's folder (`.dimsum/extensions/<name>/.status.json`, or the same under `~/.dimsum/extensions/` for your own extensions). An agent that has just saved the extension reads it to see whether the extension is running, and can fix an error without asking you to read the panel.

```json
{ "status": "failed", "error": "Unexpected token (12:4)", "at": "2026-11-14T18:02:11.000Z" }
```

`status` is `running`, `failed`, `waiting-for-trust` or `disabled`. `error` and `stack` appear when it failed, and `at` is when the file was written. It is a report only: don't edit it. DimSum keeps it out of Git by adding `.status.json` to `.dimsum/.gitignore`.

## Asking an agent to write one

Agents can write extensions too. DimSum writes `.dimsum/AGENTS.md` into the workspace and sets `DIMSUM_GUIDE` in every session, so the agent can read the [SDK guide](/extend/sdk). Turn on the *Extension guide* instruction to point the agent at it.
