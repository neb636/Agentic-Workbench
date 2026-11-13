# Your first extension

This walks through creating a workspace extension that adds a new view.

## Create it

In the Extensions panel, choose **New workspace extension** and enter a folder name, such as `level-editor`. Use lowercase letters, digits and dashes. If the workspace isn't trusted yet, DimSum asks you to [trust it](/guide/trust) first.

DimSum creates:

| File | What it is |
| --- | --- |
| `.dimsum/extensions/level-editor/index.tsx` | The extension, with a starter view. |
| `.dimsum/AGENTS.md` | The [SDK guide](/extend/sdk), for you and for agents. |
| `.dimsum/.sdk/` | Type definitions for `@dimsum/sdk`. These are refreshed each time. |
| `.dimsum/tsconfig.json`, `.dimsum/package.json` | Type checking for your editor. Optional. |
| `.dimsum/.gitignore` | Keeps your `*.local.json` files out of Git. |

## Look at the starter

```tsx
import { useState } from "react";
import { defineExtension, type ViewComponentProps } from "@dimsum/sdk";

function LevelEditorView({ workspace }: ViewComponentProps) {
  const [count, setCount] = useState(0);
  return (
    <div style={{ padding: 24, display: "grid", gap: 12, color: "var(--wb-text-primary)" }}>
      <h2 style={{ margin: 0 }}>Level Editor</h2>
      <p style={{ margin: 0, color: "var(--wb-text-secondary)" }}>A custom view for {workspace.name}.</p>
      <button type="button" onClick={() => setCount(count + 1)}>Clicked {count} times</button>
    </div>
  );
}

const Icon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
  </svg>
);

export default defineExtension({
  name: "Level Editor",
  description: "A starter workspace extension.",
  activate(ctx) {
    ctx.views.register({
      id: "level-editor.view",
      label: "Level Editor",
      description: "A custom view from this workspace's .dimsum/extensions.",
      icon: Icon,
      component: LevelEditorView,
    });
  },
});
```

Open the workspace's + menu. **Level Editor** is now one of the view types.

## Change it

Edit the file and save. DimSum reloads the extension, and the open view picks up the change. The same happens when you save any other workspace file the extension imports, so you can split it into several files.

Some rules to keep in mind:

- **Prefix ids** with the folder name and a dot (`level-editor.view`). Other ids are refused.
- **Imports**: `react`, `react-dom` and `@dimsum/sdk` come from the app. Install any other package inside the workspace, for example in `.dimsum/node_modules`, and it is bundled with the extension.
- **Style** with the app's theme variables, such as `--wb-text-primary`, `--wb-bg-panel` and `--wb-accent`, so the view works in light and dark themes.

## Add a send check

Add a guard to `activate` that warns when a prompt mentions binary files:

```tsx
import { defineExtension, guard, pattern } from "@dimsum/sdk";

// inside activate(ctx)
ctx.beforeSend(guard("level-editor.no-binaries",
  pattern(/\.(png|glb)\b/i, "Describe assets instead of pasting binary file names."),
  { onMatch: "warn" }));
```

The [SDK guide](/extend/sdk) lists everything `ctx` offers.

## Type checking (optional)

DimSum compiles the extension itself. If you want your editor or CI to check types, run this in `.dimsum/`:

```sh
npm install
npm run typecheck
```

## Share it

Commit `.dimsum/extensions/level-editor/` and `.dimsum/AGENTS.md`. Your teammates get the extension once they trust the workspace.
