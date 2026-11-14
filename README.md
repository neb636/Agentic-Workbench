# DimSum

A local, extensible Electron workbench. Coding sessions run native Codex or Claude Code CLIs above a prompt composer.

**Documentation:** https://neb636.github.io/Agentic-Workbench/ (source in [`site/`](site/)).

## Run

```sh
npm install
npm run dev
```

Install and authenticate your preferred CLI separately. Add a workspace, choose a harness, and select **Start session** or **Resume…**. Both CLIs keep their native permissions, menus, commands, and terminal input.

The composer supports personas, appended instructions, and file attachments (the + button, drag and drop, or a pasted screenshot). Press Cmd/Ctrl+Enter to send; Enter inserts a newline. You can draft while an agent works, and submit through its native queue or steering when its input editor is available. Handle approvals and slash commands in the terminal.

Sessions keep running across tab and workspace switches while the app is open. Closing the view or app stops its owned process. Reopening the app restores your drafts and layout; use Resume to choose a saved native session.

Executable discovery checks PATH and common local installation directories. Override discovery with `WORKBENCH_CODEX_PATH` or `WORKBENCH_CLAUDE_PATH` before launching DimSum. `WORKBENCH_USER_DATA_DIR` selects an isolated profile for testing.

## Checks

```sh
npm run lint
npm run build
node scripts/qa-electron.mjs
npm run qa:composer
```

The Electron QA scripts run the real app in a hidden window by default, including renderer interactions and screenshot capture. Build first with `npm run build`. Set `QA_VISIBLE=1` before a QA command to show the window for interactive inspection, for example `QA_VISIBLE=1 npm run qa:composer`. Hidden-window QA still requires a graphical desktop; use visible mode for checks that depend on native window focus or manual visual inspection. Artifacts are saved to the temporary directory printed by each script. `qa:composer` uses a deterministic CLI fixture; `qa-electron.mjs` exercises installed CLIs and `--plan` runs a live planning smoke test.

See [architecture and extension seams](docs/architecture.md) for provider, terminal, runtime, and prompt-contribution contracts and verification limits.

## Security and releases

DimSum remembers execution trust for source-control actions and AI change preparation. Reset trust and clean attachments for closed views in Settings. Native agent approval prompts remain authoritative. See [security controls and release prerequisites](docs/security-implementation.md) and [security reporting](SECURITY.md).
