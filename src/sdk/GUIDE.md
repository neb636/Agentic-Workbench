# Extending this app

This workspace is open in DimSum, a workbench for coding agents. You can change what the app shows here
(views, side panels, composer menus, checks before a prompt is sent) by writing a TypeScript extension. The app
picks it up as soon as you save the file. You don't build, install or restart anything.

The app ships this guide. Each new version of the app refreshes it, so trust it over memory.

## Where things live

| Folder | Who it is for | Runs |
| --- | --- | --- |
| `<workspace>/.dimsum/extensions/<name>/index.tsx` | Everyone who works in this workspace (check it in) | Only after the person trusts the workspace |
| `~/.dimsum/extensions/<name>/index.tsx` | The person, in every workspace | Always |
| `<workspace>/.dimsum/<name>.json` | Shared settings, checked in (`instructions.json`, `settings.json`) | n/a |
| `<workspace>/.dimsum/<name>.local.json` | The person's own settings for this workspace, never committed | n/a |
| `~/.dimsum/<name>.json` | The person's own settings everywhere | n/a |

`settings.json` turns extensions off with `{ "version": 1, "extensions": { "disabled": ["workspace:hello"] } }`. A
workspace extension can be turned off in any of the three files; a user extension (`user:<name>`) runs once for every
workspace, so only `~/.dimsum/settings.json` turns it off.

Inside a terminal or agent session the app sets `DIMSUM_HOME` (the `~/.dimsum` folder) and `DIMSUM_GUIDE` (this
file).

## An extension

```tsx
// .dimsum/extensions/level-editor/index.tsx
import { useState } from "react";
import { defineExtension, guard, pattern, promptMenu, group, toggle, select, choice, harness, type ViewComponentProps } from "@dimsum/sdk";

function LevelEditor({ workspace }: ViewComponentProps) {
  const [zoom, setZoom] = useState(1);
  return <div style={{ padding: 16, color: "var(--wb-text-primary)" }}>Editing levels in {workspace.name} at {zoom}×</div>;
}

const Icon = ({ size = 16 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="2" fill="none" stroke="currentColor" /></svg>;

export default defineExtension({
  name: "Level editor",
  description: "Edit levels without leaving the workbench.",
  activate(ctx) {
    ctx.views.register({ id: "level-editor.view", label: "Level editor", description: "Edit a level.", icon: Icon, component: LevelEditor });
    ctx.panels.register({ id: "level-editor.panel", label: "Levels", icon: Icon, component: () => <p>Levels</p> });
    ctx.commands.register("level-editor.open", ({ workspaceId }: { workspaceId: string }) =>
      ctx.commands.execute("view.create", { workspaceId, viewType: "level-editor.view" }));

    ctx.promptMenus.register(promptMenu({
      id: "level-editor.menu", label: "Levels", icon: Icon, placement: "append",
      items: [
        group("Verification", [
          toggle("level-editor.playtest", { label: "Playtest", text: "Run the level in the game and describe what you saw." }),
          select("level-editor.scope", { label: "Scope", display: "segmented", choices: [
            choice("one", "One level"), choice("all", "All levels", "Check every level, not only the one changed."),
          ] }),
        ]),
        toggle("level-editor.claude-only", { label: "Use subagents", text: "Use subagents for each level.", when: harness("claude.cli") }),
      ],
    }));

    ctx.beforeSend(guard("level-editor.no-binaries", pattern(/\.(png|glb)\b/i, "Describe assets instead of pasting binary file names."), { onMatch: "warn" }));

    ctx.events.on("view.opened", (event) => console.log("opened", event.type));
  },
});
```

Rules:

- **Ids.** Prefix every id you register with your folder name and a dot (`level-editor.view`). Anything else is
  refused. The prefix shows where a contribution came from and keeps extensions from replacing each other's.
- **Imports.** `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client` and `@dimsum/sdk` come from the app, so
  everything shares one React. Other packages must be installed inside the workspace (for example
  `.dimsum/node_modules`) and are bundled with the extension. Files outside the workspace can't be imported.
- **Styling.** Use the app's semantic CSS variables (`--wb-text-primary`, `--wb-text-secondary`, `--wb-bg-panel`,
  `--wb-bg-raised`, `--wb-border`, `--wb-accent`, `--wb-status-error`, ...) rather than literal colours, so light
  and dark themes both work.
- **Clean-up.** Everything registered through `ctx` is removed when the extension reloads or is turned off. If you
  start your own timers or listeners, push a `{ dispose() }` onto `ctx.subscriptions` or return one from `activate`.
- **Failure.** If `activate` throws, nothing it registered stays behind and the Extensions panel shows the error.
  A view that throws while rendering shows its error in place, and the rest of the app keeps working. A save that
  doesn't compile keeps the last version that did.
- **Did it run?** After every build and activation the app writes `.status.json` into the extension's folder
  (`.dimsum/extensions/<name>/.status.json`, or the same under `~/.dimsum`). After saving, read it to see whether
  your extension is running: `{ "status": "running" | "failed" | "waiting-for-trust" | "disabled", "error"?, "stack"?, "at" }`.
  `error` is the compile or activation message; `at` is when it was written, so wait for it to change after a save.
  The file is only a report, is kept out of Git, and is never something to edit.

## What `ctx` offers

| Member | What it does |
| --- | --- |
| `ctx.views.register(def)` | A view type. It shows in the new-view (+) menu unless `creatable: false`. A view is saved UI state (`view.state`) and doesn't need a running process. |
| `ctx.panels.register(def)` | A right-sidebar panel. |
| `ctx.widgets.register(def)` | A component in a slot: `statusbar.start`, `statusbar.end`, `sidebar.footer`, `sidebar.workspace.meta`, `settings.general` or `agent.composer.toolbar`. |
| `ctx.commands.register(id, fn)` / `ctx.commands.execute(id, args)` | Commands. The app's own include `view.create`, `view.activate`, `view.close`, `file.open` and `agent.composer.attach`. |
| `ctx.promptMenus.register(menu)` | A composer menu whose options add text before or after the prompt. Build one with `promptMenu`, `group`, `toggle`, `select`, `multiSelect`, `textInput` and `choice`. Show an option only sometimes with `when` and the conditions `allOf`, `anyOf`, `not`, `isOn`, `isChoice` and `harness`. |
| `ctx.promptContributors.register(c)` | Adds text to every prompt (context, attachments). |
| `ctx.contextMenus.register(c)` | Items for the menus of workspaces, views, files and selected text. |
| `ctx.beforeSend(guards)` | Checks before a prompt is sent. Build one with `guard(id, detector, { onMatch: "block" \| "warn" })`. The detectors are `maxLength(n)`, `pattern(re, message)`, `secrets()` and `nativeCommand()`, or any `(input) => string \| undefined`. |
| `ctx.events.on(name, fn)` | Notifications: `workspace.opened`, `workspace.closed`, `view.opened`, `view.closed`, `view.activated`, `view.status`, `prompt.sent`, `extension.activated` and `extension.failed`. A handler can't stop what happened. Only guards can refuse a send. |
| `ctx.files` | `read`, `list` and `write` text files of this workspace (workspace extensions only). Writes are checked against the hash you last read. |
| `ctx.extension` | Who you are: `id`, `name`, `layer` and, for a workspace extension, `workspaceId` and `root`. |
| `ctx.ui.LocalPreview` | A component that shows a page served on this machine (a development server) inside your view. See below. |

A workspace extension's contributions appear only in its own workspace. Two worktrees of one repository each run
their own copy.

## Showing a local page

`ctx.ui.LocalPreview` shows a page from a server on this machine, such as a game's or a site's development server,
inside one of your views or panels. Use it when the thing you are building a tool for is itself a web page.

```tsx
function Game({ workspace }: ViewComponentProps) {
  const [snapshot, setSnapshot] = useState<unknown>();
  const connection = useRef<LocalPreviewConnection>();
  return <ctx.ui.LocalPreview
    url="http://127.0.0.1:5174/#/lab?feel=1"
    title="Game"
    onConnect={(next) => { connection.current = next; next.post({ type: "snapshot" }); }}
    onMessage={(data) => setSnapshot(data)} />;
}
```

`ctx` is the one `activate` received, so declare such components inside `activate` (or pass `ctx.ui.LocalPreview` to
them).

- **Only this machine.** The URL must be `http` or `https` on `127.0.0.1` or `localhost`. Anything else shows an
  error instead of a frame. The page, and any frame it opens, can't navigate anywhere else.
- **No access to the app.** The page runs in a sandboxed frame with its own origin. It can't reach the app, open
  popups, download, or use the clipboard, camera or other permissions. The app doesn't start the server; the person
  (or a terminal view) does.
- **Talking to the page.** The page posts `{ dimsum: "local-preview.hello" }` to its parent when it is ready to talk.
  The app answers with `{ dimsum: "local-preview.connect" }` and a `MessagePort` in `event.ports[0]`, and calls your
  `onConnect` with a connection whose `post(data)` sends to that port. Whatever the page sends on the port reaches
  `onMessage`. After a reload or a navigation the page says hello again and you get a new connection; the old one
  does nothing. What the page sends is its own data: check it before acting on it.

The page's side:

```ts
addEventListener("message", (event) => {
  if (event.source !== parent || event.data?.dimsum !== "local-preview.connect") return;
  const port = event.ports[0];
  port.onmessage = ({ data }) => { if (data.type === "snapshot") port.postMessage(readSnapshot()); };
});
if (parent !== window) parent.postMessage({ dimsum: "local-preview.hello" }, "*");
```

The hello carries nothing, so posting it to `"*"` gives nothing away. The page doesn't need to know the app's origin,
but it can check `event.origin` on the connect message (`workbench://app` in the installed app).

## Types

The types are in `.dimsum/.sdk/` and `.dimsum/tsconfig.json` maps `@dimsum/sdk` to them. To type-check, run
`npm install` and then `npm run typecheck` inside `.dimsum/`. That step is optional, because the app compiles the
extension itself.

## Trust

Workspace extensions run inside the app with the same access the app has. The app runs them only after the person
trusts the workspace. That is the same trust that lets source-control actions run repository hooks. Never ask the
person to trust a workspace on someone else's behalf.
