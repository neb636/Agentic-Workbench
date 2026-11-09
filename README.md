# Agent Workbench

A local, extensible Electron workbench. Coding sessions run native Codex or Claude Code CLIs above a prompt composer.

## Run

```sh
npm install
npm run dev
```

Install and authenticate your preferred CLI separately. Add a workspace, choose a harness, and select **Start session** or **Resume…**. Both CLIs keep their native permissions, menus, commands, and terminal input.

The composer supports personas, appended instructions, and file attachments (the + button, drag and drop, or a pasted screenshot). Press Cmd/Ctrl+Enter to send; Enter inserts a newline. You can draft while an agent works, and submit through its native queue or steering when its input editor is available. Handle approvals and slash commands in the terminal.

Sessions keep running across tab and workspace switches while the app is open. Closing the view or app stops its owned process. Reopening the app restores your drafts and layout; use Resume to choose a saved native session.

Executable discovery checks PATH and common local installation directories. Override discovery with `WORKBENCH_CODEX_PATH` or `WORKBENCH_CLAUDE_PATH` before launching Workbench. `WORKBENCH_USER_DATA_DIR` selects an isolated Workbench profile for testing.

## Checks

```sh
npm test
npm run lint
npm run build
node scripts/qa-electron.mjs
```

See [architecture and extension seams](docs/architecture.md) for provider, terminal, runtime, and prompt-contribution contracts and verification limits.
