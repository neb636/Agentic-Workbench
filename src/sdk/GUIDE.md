# Extending this app

This workspace is open in an agent workbench (working name DimSum). You can change what the app shows here
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

A workspace extension's contributions appear only in its own workspace. Two worktrees of one repository each run
their own copy.

## Types

The types are in `.dimsum/.sdk/` and `.dimsum/tsconfig.json` maps `@dimsum/sdk` to them. To type-check, run
`npm install` and then `npm run typecheck` inside `.dimsum/`. That step is optional, because the app compiles the
extension itself.

## Trust

Workspace extensions run inside the app with the same access the app has. The app runs them only after the person
trusts the workspace. That is the same trust that lets source-control actions run repository hooks. Never ask the
person to trust a workspace on someone else's behalf.
