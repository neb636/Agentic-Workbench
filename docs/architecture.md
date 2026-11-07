# Architecture

Kaylee Gamepack Studio is this repo’s local Electron builder app, imported from Agent Workbench. It opens the current game checkout, embeds the existing character/Camera/Feel labs, and adds AI numeric preview and the character recipe from `docs/3d-characters.md`. Concrete harnesses live behind provider adapters; the renderer has no Node access. Existing registries and prompt contributions are retained.

## Game labs

The studio renderer is on 5175. Each piece of work gets its own loopback game server from `GameServerPool` (`main/game-server.ts`): ports from `GAME_PORTS` (5174, 5176, …), the two most recently used kept running, a busy port skipped. `npm run studio` starts its own checkout's server on 5174 itself and tells Electron (`STUDIO_GAME_PORT`), so the pool uses it as is and never stops it. The game shares only the dependency-free `shared/labs.ts` protocol; Electron never enters the web build. A development-only bridge accepts messages from the exact studio origin and parent window: the labs answer snapshot/apply requests, and `useStudioLocation` (mounted in the game's `App`) reports the URL twice a second, since `enter()` rewrites it with replaceState. The renderer accepts a message only from its own pane's iframe and that pane's origin. Each request reads fresh state. Numeric proposals are checked atomically and rejected after a route, mode, frame or value changes. Preview updates the live controls and URL; Undo restores the previous values. Links persist across view switches. Preparing a save prompt reads the live state again and opens the normal CLI composer for review.

The main-process LabAi runner uses fixed executable names, argument arrays, a scratch directory, response schemas, ownership checks, cancellation, output bounds and a three-minute deadline. Claude tuning disables tools/MCP; Codex tuning uses read-only sandbox. Interactive coding sessions retain normal CLI permissions. All native IPC rejects child frames.

Character concepts use one image per iteration, real pixel-based 1024×1024/transparency checks, same-character refinement, and prompts for the manual Tripo, Blender and game-integration stages. Chosen image paths accompany the handoff. Private inputs stay in local app data; runtime GLBs are integrated only after Dad approves.

## Views and runtime resources

A persisted Workspace owns View records. An Agent view persists provider selection, run location (workspace checkout or a new worktree), the resolved working folder, composer draft, quoted selections, prompt-option selections, submission intent, composer revision, and split position. A new or restored view shows the "Start a new session" launcher with the composer below it. The CLI starts when the first prompt is sent (or on Start session / Resume): Workbench prepares the folder, launches the CLI, waits for a submittable native input, then delivers the composed prompt. The first sent prompt becomes the session title. A File view persists only a workspace root and relative path; it has no Session.

Agent runtimes are separate from views and React components. The renderer runtime registry holds controller and status references; the main-process AgentSessionManager owns the PTY, bounded headless terminal, and provider. Switching tabs or workspaces releases only the terminal attachment. Closing a view terminates its runtime. Window destruction and application shutdown clean up all owned runtimes.

After application restart, Start launches a new CLI; Resume launches the selected provider's native session picker. Workbench does not persist process IDs or infer a native conversation identity. Ordinary shell Terminal views currently retain their component-scoped lifetime.

## Shell

The shell is three resizable, collapsible cards over the app canvas plus a status bar, all built on accessible primitives:

- Left sidebar: the **Work list**. `PersistedState.repoRoot` is the one Gamepack checkout; `WorkService` (`main/work.ts`) reads `git worktree list --porcelain` and `gh pr list --json` (cached a minute, missing `gh` means no PR info) and returns main plus every worktree with branch, PR, CI and change count. Each listed worktree becomes a readable root. A Workspace record is the views of one piece of work, keyed by its path; selecting a row opens it. Groups: main, in progress, finished (merged, closed or missing; collapsed, with Clean up). New work is `<login>/<name>` from `origin/main` in `<repo>-worktrees/<name>`, followed by `npm ci`. Removal refuses main, locked or dirty worktrees, and unpushed commits unless the PR's head is the local head; it never forces and keeps the branch. Session rows show `{status} · {provider}` from the generic view-status store; the `sidebar.footer` slot supplies navigation.
- Middle: one tab strip (`shell/CenterArea.tsx` + `ViewTabs.tsx`) for the selected piece of work, one tab on screen: agents, terminals, the game and its labs, files, Character concepts. The **+** menu lists them (a ViewDefinition's `menuItems` gives the game a line per lab and agents a line per CLI). Tabs drag to reorder (`moveView`; the draggable is a span inside the react-aria Tab) and a right-click opens Close, Close others and the type's own `tabMenu` items (Copy path, Switch to Codex…). Terminal tabs and the game stay mounted behind other tabs. Tabs that do not fit move into "+N more"; the active tab stays visible.
- The game: one `game` view type, its lab in `GameViewState.lab` (🎮 Game, 🎥 Camera lab, 🎛️ Feel lab, 🦄 Character lab). `GamePane` (`features/game/`) is mounted once per piece of work for the game tab on screen, or the last one shown (`useGameLive.liveView`); it stays loaded, hidden and slowed to the background pace (`studioFocused: false`), while another tab is on screen. Going to another game tab opens that tab's link in the same frame (`tabLink`: the section on screen with `?cam=1` / `?feel=1`, or the Character lab's own link), so one game runs per piece of work. Its toolbar fits one line: breadcrumb (click to paste a link), device frame, reload, ⇆ Main, 🐞 N, Copy link, → Agent. The lab's `LabPanel` sits beside the frame when the tab is at least 1100 px wide and under it otherwise. ⌘G (a View menu accelerator, so it works inside the game frame) is `focusGame`; `openInGame` (Sections) navigates the loaded game tab, or opens one. With no game tab in the piece of work on screen, the servers stop after a minute. `migrateStudioTabs` turns a saved open game panel (`game.open`) into a Game tab after the first agent. **⇆ Main** splits the stage with main's own game server; main follows every navigation made here. **🐞 N** lists the open entries of the country's `known-issues.md` for this activity.
- Agents: a new agent tab (+, a Work row's **+ Claude** / **+ Codex**, a new piece of work) has `autoStart` and starts the last-used CLI (`layout.lastAgentProvider`) as soon as it's shown; a tab whose CLI isn't running (Studio restarted) shows a small card with the CLI picker, Start and Resume previous. The composer accepts a prompt while the CLI is still starting and sends it once the CLI can take it (`agent.composer.send` waits `untilSubmittable`). The composer toolbar carries **📎 Section** and **Starters**; `features/agent/attention.ts` badges Work rows, sets the Dock badge and chimes.
- Right: the **explorer** (`shell/RightSidebar.tsx`), with an icon bar: **Files** (`features/files/FilesPanel.tsx`: the lazy tree with M / A / U marks from `sourceControl.status`, ignored paths dimmed from `sourceControl.ignored` (`git ls-files --others --ignored --exclude-standard --directory`), *Names | Contents* search, the file on screen revealed, a ⋯ menu per row: New file, New folder, Rename, Copy path, Reveal in Finder, Move to Trash), **Changes** (`SourceControlPanel`: a click opens the file's diff, the commit box, branch switching folded away), **Sections** (`SectionTree`: a click opens it in the game tab) and **Ship** (`ShipPanel`, docked). ⌘⌥B hides it; `layout.explorer` keeps `collapsed`, `size` and `tab`. Ship's Verify, Screens and Voices run as fixed command strings in the piece of work's Ship terminal tab.
- File tabs (`features/files/FileView.tsx`): one click opens a *preview* tab (italic; the next one-click open replaces it), a double click, an edit or a save keeps it. CodeMirror with history, `@codemirror/search` (⌘F) and ⌘S; a dot on the tab while unsaved, and closing asks. `files.read` returns a sha1 `hash`; `files.write` saves only over that hash, so an agent's newer edit is never overwritten: a clean tab reloads by itself, an edited one shows *Changed on disk: Reload / Keep mine*. **⇄ Diff** adds `@codemirror/merge`'s unified view in the same editor against `sourceControl.fileAt(root, path, "main" | "head")` (the merge base with origin/main for a worktree, the last commit for main). Pictures show as pictures (`files.image`, up to 8 MB). ⌘P is the Go to File box (`QuickOpen.tsx`), ⇧⌘F opens Files on *Contents*. Terminals turn `path(:line(:col))` in output into links when the path is a file of the checkout (`files.exists`), opening it at that line.
- Status bar: the `statusbar.start` and `statusbar.end` widget slots.

Panel sizes, collapsed flags, and the active panel persist in `PersistedState.layout`. Features publish live view status (label, tone, detail, unseen completion) through `publishViewStatus`; a ViewDefinition may supply `idleStatus` for views without a live resource. The shell never inspects agent runtimes directly.

The theme is hybrid: light chrome tokens in the game's pastels (cream, pink, lavender, ink) with Fredoka (`@fontsource/fredoka`), flat and matte with no glossy highlights, and dark `--wb-code-*` and `--wb-terminal-*` surfaces, defined in `theme/tokens.css`.

## Native terminal pipeline

```text
Agent view / prompt composer
  -> generic agent controller
  -> narrow typed preload API + validated, owner-checked IPC
  -> AgentSessionManager
  -> registered provider + shared PTY spawn service
  -> native interactive CLI
```

Codex launches as an interactive executable, not `codex exec`; Claude Code uses the same session contract. Provider adapters own executable configuration, launch/resume arguments, interrupt keys, paste encoding, and native-screen interpretation.

The main process parses every PTY chunk using xterm headless with 2,000 lines of scrollback. Attachments receive a serialized screen and sequence number, then consume only newer events. This prevents lost startup output and duplicate replay. Status remains available while the renderer surface is unmounted. The main terminal answers terminal queries; the renderer suppresses duplicate device-query responses.

TerminalSurface handles theme, display, input, and sizing for both agent and shell views. Process creation and termination remain outside this display component. The terminal/composer split uses an accessible panel primitive.

## Prompt contributions and delivery

PromptContributorRegistry supplies removable contributor registrations. Prompt menus and terminal quotations register their contributions through this seam. PromptAssembler (`shared/prompt-assembly.ts`) puts prepended contributions before the user text and appended ones after it.

Composer menus are declared with the prompt-option DSL in `shared/prompt-options.ts`:

- Builders: `toggle`, `select`, `multiSelect`, `textInput`, and `choice`.
- Conditions: `allOf`, `anyOf`, `not`, `isOn`, and `isChoice`.
- Definitions are plain data and validated by `promptOptionDefinitionSchema`, so built-in and user-managed options share one schema.
- `PromptMenuRegistry` entries declare a placement, a reset-after-send default (options may override it), a contribution kind, an options function, and an optional manager.
- The generic `prompt-menus` contributor resolves every menu against the view's selections. Options hidden by `when` contribute nothing, and conditions on hidden options are false.
- The first-party menu is Instructions: built-in options plus stored `instructionOptions`, appended, kept between sends. Personas were dropped for now; stored personas stay in the state file.
- Older `appendedInstructions` state migrates to workspace-scoped toggles on load. Preview and Send use the same assembly path. TerminalSurface exposes selected text and a focus handle without leaking xterm to the composer. Quotations capture selected text only; Workbench does not reconstruct assistant messages from terminal output.

The agent composer registers quote, preview, recall, and send commands through CommandRegistry. Its feature-owned store tracks delivery and up to 20 recent submissions/saved drafts per view, bounded to 2 million serialized characters. History remains in memory until the view closes or the app restarts. Recall saves the current draft before restoring text, quotations, and intent, then uses current persona/instruction contributions on the next send. It refuses to replace a draft too large to save. Revision checks protect edits made during asynchronous delivery, including when the view is detached.

The composer keeps model and effort choices per provider in each agent tab. They are **launch arguments** of a new conversation, never typed into a running CLI: Codex `--model <id> -c model_reasoning_effort="<effort>" -c plan_mode_reasoning_effort="<effort>"`, Claude `--model <id> --effort <effort>` (before `--allowedTools`, which takes every later argument). A resumed conversation keeps what it was saved with. Each runtime remembers what it was launched with: changing the choice before the first prompt makes Send restart the CLI with it, and after a prompt the composer offers **Restart with …**, which keeps the draft.

The main process serializes composer delivery against direct terminal input, verifies an empty native input editor, pastes in bracketed pieces of at most 2 KiB (4 ms apart), waits up to two seconds for a recognized native draft, waits 150 ms of output quiet, then sends Enter. Every wait is either a poll for a screen condition (`waitFor`, every 50 ms) or an output-quiet window (`settle`, quiet measured from the call and the last output, checked every 25 ms, capped at 2 s). Existing native drafts, approval and update dialogs, unavailable paste mode, unknown UI, and exited processes reject automated submission. Typed delivery outcomes distinguish submitted (handed to the CLI, not proof of processing), not sent, and uncertain, with the last attempted stage. The composer retains its draft/context on failure or uncertain delivery and never retries automatically. Focus terminal and Copy composed prompt provide explicit handoff.

A first prompt after launch waits until the CLI is ready: a recognized empty prompt with paste mode, no work in progress (Codex also says so itself with `OSC 7501 state=idle|working|done`, and spins its window title while starting), at least 300 ms of output quiet (Codex 1 s), and the window's terminal at its real size or 3 s since launch. While the composer holds a prompt for a CLI that waits on the person (a question, a draft in its input) it says so and waits up to five minutes.

Only typing counts as editing the native draft. Mouse reports (Codex 0.166+ tracks every pointer move), focus changes and replies to terminal queries are forwarded but never mark the input edited; counting them once made Codex's dim placeholder read as a draft forever. Codex's placeholder is recognized by its dim style alone. The window's terminal leaves device, cursor and colour queries to the headless parser in main, so the CLI gets one reply.

Submission requests contain text and a generic `default` (Code) or `plan` intent, and the composer's mode is the truth: before pasting, main reads the mode from the footer under the prompt and switches if it differs. Codex: Plan types `/plan` (which takes no prompt), lets the slash picker settle, checks the command is in the editor, presses Enter and waits up to 10 s for `Plan mode` in the footer (the picker's "switch to Plan mode" hint doesn't count), looking again after a quiet moment for 4 s more; Code presses Shift+Tab. Claude: Shift+Tab, checking the footer after each press, at most five presses, to `plan mode on`, and back to the mode the session started in (auto, manual, accept edits...), never to bypass permissions. A switch that can't be confirmed reports not sent before the prompt is pasted. Mode switches need a ready CLI; a send while it works keeps the native queue/steering behaviour only when no switch is needed.

When the CLI is working and its input editor is available, submission follows the harness's native steering/queue behavior. Workbench does not own a second prompt queue. Approval responses and slash commands belong in the terminal. Interrupt sends the provider's native interrupt key; it does not terminate the session.

## Status and extension boundaries

Process lifecycle (`starting/alive/exited/failed`) is separate from inferred activity (`ready/working/waiting-for-input/unknown`). Provider-owned rules examine the live bottom screen and cursor position, not the scrolled renderer viewport. Unmatched screens stay unknown; output silence is never completion. A recognized working-to-ready transition records a completion attention event, distinct from task success; an observed interrupt suppresses it. Background tabs show unseen completions until opened.

Status includes the detector rule, observation time, input-editor state, and reason. Diagnostics are available through the typed snapshot; the toolbar exposes the current rule in its tooltip. Detection is heuristic and CLI UI changes can require rule updates. No global hooks or CLI configuration edits are installed. A later provider can supply complete native lifecycle signals behind the same generic status interface.

To add a harness, implement AgentProviderAdapter in main, register it at the composition root, and register its generic renderer provider. Do not add harness checks to AgentView or Workbench core. To add composer behavior, register a prompt menu, a prompt contributor, or a widget in the `agent.composer.toolbar` slot.

## Image generator

The Character concepts view is a prompt composer with image attachments and a gallery. Generate copies staged attachments into a private run folder and sends one recipe-specific orchestration prompt through the selected Claude Code or Codex session. The orchestrator writes one concept prompt, runs one `codex exec` image command and records `manifest.json`. The recipe requires a transparent 1024-square vinyl toy in front-facing A-pose, preserves the same character during refinement, and changes only Dad’s requested detail. The renderer decodes actual output pixels before allowing Choose. The workflow selector builds prompts for Tripo, four-mesh comparison, rigid-pivot Blender rigging and game integration, including a chosen concept’s absolute local path.

Files live under `<userData>/image-generator/<viewId>/`: `attachments/` for staged images and one folder per run with `source-N`, `variant-N.md`, `candidate-N.png`, and `manifest.json`. `ImageLibrary` in main is the only file access: it identifies images by content and keeps every path inside the view folder. The gallery polls a run until its manifest is complete, and for a minute after a retry. Images stay on disk when the view closes. The view persists the draft, attachments, run metadata, chosen candidate, and variant count, not the images.

Claude orchestration uses the main-process `image-generator` launch profile, scoped to the local image library. The Claude adapter maps it to `--permission-mode acceptEdits --allowedTools "Bash(codex exec *)"`. Codex orchestration uses its ordinary native permission flow without that Claude-only profile. Trust and permission prompts appear in the Agent drawer, which opens when the session waits for input.

## Workspace files and source control

`WorkspaceRoots` in main lists the folders the renderer may read: persisted workspace paths, folders chosen in the add-workspace dialog, and worktrees created beside a workspace in `<workspace>-worktrees/`.

`WorkspaceFiles` serves `files:list`, `read`, `find`, `write`, `search`, `image`, `exists`, `create`, `rename`, `trash`, `reveal` and `watch`:

- Every request is resolved with realpath and contained within its root, so `..` paths and escaping symlinks are rejected. A new path's folder must exist inside the root, and nothing writes inside `.git`.
- Reads are capped at 2 MB, and binary files are detected. Writes are text only, up to 2 MB, atomic (a temporary file renamed over), and refused when the file on disk no longer matches the hash the tab opened (the disk version comes back instead).
- `search` is `git grep -n -I --untracked -z` with fixed arguments (`-F` unless regex, `-i` unless match case), at most 500 matches or 2 s; a new search in the same root kills the last.
- Move to Trash uses Electron's `shell.trashItem`; nothing is deleted outright.
- Search is a bounded walk that skips `.git` and `node_modules`.
- Watches are recursive, debounced, and shared per root. They are owned by the requesting window and released when it closes.

The renderer shares one watch per root through `core/workspace-watch.ts`.

Source control sits behind `SourceControlProvider` (detect, status, commit-all, create worktree), selected per root by `SourceControlService`. `GitSourceControlProvider` is the only adapter:

- It runs fixed git argument lists with `execFile`. No shell is involved, and no caller-supplied arguments are accepted beyond validated branch names and commit messages.
- It parses `status --porcelain=v2 -z`.

Core and the renderer see only the generic `sourceControl` API and types.

## Validation

`npm test` covers adapter launch contracts, ANSI redraws, prompt controls and multiline content, planning command acknowledgment, delayed paste acknowledgment, native draft collisions, concurrent delivery, approval races at command/paste/Enter stages, status/interrupt transitions, owner isolation, replay, process exit, and missing executables.

`npm test` also covers the prompt-option DSL and assembly order, state migration, workspace file containment, and the Git adapter (porcelain parsing, commit, worktrees) against temporary repositories.

After `npm run build`, `npm run qa:composer` runs deterministic Electron checks against an isolated simulated CLI, a temporary Git repository, and isolated app persistence. It covers:

- the three-pane shell and nested sessions;
- the restart card of a saved session whose CLI isn't running;
- the Instructions menu, including a conditional option and a migrated instruction;
- the exact composed prompt and the folder it was delivered in;
- the title taken from the first prompt;
- quote, preview, and recall;
- uncertain delivery handoff;
- the explorer: the Files tree, search by name and inside files, a preview tab, editing and ⌘S, a reload when the file changes on disk, a diff;
- Changes and commit, Ship's Verify in its terminal tab;
- a Game and a Feel tab sharing one game that stays loaded behind the agent;
- the Work list and tab overflow;
- layout persistence across restart. Screenshots are saved in the printed temporary directory.

`node scripts/qa-electron.mjs --plan` sends harmless no-tools planning checks to installed CLIs, twice to cover an already-planning session. Native account/permission gates remain untouched and are reported as unverified. Use `--claude-only` to target Claude during diagnosis.

`npm run build && node scripts/qa-electron.mjs` runs Electron QA with isolated Workbench persistence. Set `QA_SEND=1` for a harmless live Codex response, or `QA_CLAUDE_SEND=1` for Claude delivery (requires native authentication and uses the user's CLI account). The Claude check follows the native workspace trust flow; it never selects a billing/model-credit option. No application account or API key is introduced.

Verified locally on macOS (2026-11-06) through the built session manager against the real CLIs: Codex 0.167.0 and Claude Code 2.1.319 launch with the composer's model and effort, become ready with the mouse moving over the terminal, take a Plan prompt in their Plan mode and a following Code prompt back in the original mode, both answered. `tests/fixtures/{codex,claude}.json` are recorded transcripts (`node scripts/cli-probe.mjs`) that `tests/agent-sessions.test.mjs` replays: re-record them when a CLI update changes its screens. Other operating systems need live verification; terminal input modes such as Vim mode may produce Unknown, and direct terminal interaction remains available.
