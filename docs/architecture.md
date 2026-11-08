# Architecture

Agent Workbench is a generic, local Electron workbench. Concrete harnesses live behind provider adapters; the renderer has no Node access. First-party features use the same registries and prompt contributions available to future extensions.

## Views and runtime resources

A persisted Workspace owns View records. An Agent view persists provider selection, run location (workspace checkout or a new worktree), the resolved working folder, composer draft, quoted selections, prompt-option selections, submission intent, composer revision, and split position. A new or restored view shows the "Start a new session" launcher with the composer below it. The CLI starts when the first prompt is sent (or on Start session / Resume): Workbench prepares the folder, launches the CLI, waits for a submittable native input, then delivers the composed prompt. The first sent prompt becomes the session title. A File view persists only a workspace root and relative path; it has no Session.

Agent runtimes are separate from views and React components. The renderer runtime registry holds controller and status references; the main-process AgentSessionManager owns the PTY, bounded headless terminal, and provider. Switching tabs or workspaces releases only the terminal attachment. Closing a view terminates its runtime. Window destruction and application shutdown clean up all owned runtimes.

After application restart, Start launches a new CLI; Resume launches the selected provider's native session picker. Workbench does not persist process IDs or infer a native conversation identity. Ordinary shell Terminal views currently retain their component-scoped lifetime.

## Shell

The shell is three resizable, collapsible cards over the app canvas plus a status bar, all built on accessible primitives:

- Left sidebar: workspaces as a tree, with views whose definition sets `listInSidebar` nested beneath each one. Rows show `{status} · {provider}` from the generic view-status store. The `sidebar.workspace.meta` and `sidebar.footer` widget slots supply extra row detail and navigation.
- Center: a tab strip over the active view. Tabs that do not fit move into a "+N more" menu, and the active tab always stays visible.
- Right sidebar: panels from `PanelRegistry` (Active views, Files, Source control), switched from an activity bar. A panel may declare a `badge` component (Source control shows its change count).
- Status bar: the `statusbar.start` and `statusbar.end` widget slots.

Panel sizes, collapsed flags, and the active panel persist in `PersistedState.layout`. Features publish live view status (label, tone, detail, unseen completion) through `publishViewStatus`; a ViewDefinition may supply `idleStatus` for views without a live resource. The shell never inspects agent runtimes directly.

The theme is hybrid: light chrome tokens and dark `--wb-code-*` and `--wb-terminal-*` surfaces, defined in `theme/tokens.css`.

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
- First-party menus are Persona (a list select of stored personas, prepended, cleared after each send) and Instructions (built-in options plus stored `instructionOptions`, appended, kept between sends).
- Older `appendedInstructions` state migrates to workspace-scoped toggles on load. Preview and Send use the same assembly path. TerminalSurface exposes selected text and a focus handle without leaking xterm to the composer. Quotations capture selected text only; Workbench does not reconstruct assistant messages from terminal output.

The agent composer registers quote, preview, recall, and send commands through CommandRegistry. Its feature-owned store tracks delivery and up to 20 recent submissions/saved drafts per view, bounded to 2 million serialized characters. History remains in memory until the view closes or the app restarts. Recall saves the current draft before restoring text, quotations, and intent, then uses current persona/instruction contributions on the next send. It refuses to replace a draft too large to save. Revision checks protect edits made during asynchronous delivery, including when the view is detached.

The main process serializes composer delivery against direct terminal input, verifies an empty native input editor, sends bracketed paste in pieces of at most 2 KiB, waits up to two seconds for a recognized native draft and a further quiet moment, then sends Enter. Existing native drafts, approval dialogs, unavailable paste mode, unknown UI, and exited processes reject automated submission. Typed delivery outcomes distinguish submitted (handed to the CLI, not proof of processing), not sent, and uncertain, with the last attempted stage. The composer retains its draft/context on failure or uncertain delivery and never retries automatically. Focus terminal and Copy composed prompt provide explicit handoff.

Submission requests contain text and a generic `default` or `plan` intent. Planning is an optional provider capability, unavailable by default. The composer's mode is authoritative: before pasting, main reads the CLI's current mode from its footer (`mode()` on the adapter) and switches when it differs, using the adapter's `enterPlan`/`leavePlan` (`ModeSwitch`):

- `command`: type it, check it in the editor (`commandTyped`), press Enter, wait for the footer (Codex `/plan`, which takes no prompt).
- `cycle`: press the key and re-read the footer after each press, at most five times (Claude's Shift+Tab; Codex leaves Plan this way).

Leaving Plan returns to the mode the session settled in, never to one the adapter calls unsafe (`isUnsafeMode`, such as skipping permission prompts). A switch that can't be confirmed stops before the paste and reports `not-sent` at stage `mode`. Planning submissions require a ready CLI, never a working session.

The first prompt waits for the CLI to settle: ready activity, a quiet period (`max(startupSettleMs, 300 ms)`), the window's terminal size (or 3 s), and, when the adapter reads one, no busy self-report (`reportedState`, Codex's OSC 7501) or busy window title (`startupBusy`, at most 15 s). Mouse reports, focus changes and terminal replies are not counted as typing. Output reaches the window at most once per frame, and status is re-read at most every 100 ms; `attach` flushes both first.

Send stays available while a CLI starts or asks something in the terminal: the composer holds the prompt until the CLI can take it (45 s, or 5 minutes while it waits on the person).

Adapters may offer `models` with per-model reasoning efforts and turn a choice into launch arguments (`modelArgs`). Discovery passes the catalogue to the renderer; the composer shows Model and Effort pickers with a "CLI default" choice that adds no arguments. Settings apply only to new conversations: before the first prompt, Send relaunches with the new choice; afterwards the composer offers "Restart with…". Main rejects any model or effort its adapter doesn't list.

`scripts/cli-probe.mjs` records what a real CLI draws into `tests/fixtures/*.json`; tests replay those recordings through the adapters. Re-record them when a CLI update changes its screens.

When the CLI is working and its input editor is available, submission follows the harness's native steering/queue behavior. Workbench does not own a second prompt queue. Approval responses and slash commands belong in the terminal. Interrupt sends the provider's native interrupt key; it does not terminate the session.

## Status and extension boundaries

Process lifecycle (`starting/alive/exited/failed`) is separate from inferred activity (`ready/working/waiting-for-input/unknown`). Provider-owned rules examine the live bottom screen and cursor position, not the scrolled renderer viewport. Unmatched screens stay unknown; output silence is never completion. A recognized working-to-ready transition records a completion attention event, distinct from task success; an observed interrupt suppresses it. Background tabs show unseen completions until opened.

Status includes the detector rule, observation time, input-editor state, and reason. Diagnostics are available through the typed snapshot; the toolbar exposes the current rule in its tooltip. Detection is heuristic and CLI UI changes can require rule updates. No global hooks or CLI configuration edits are installed. A later provider can supply complete native lifecycle signals behind the same generic status interface.

To add a harness, implement AgentProviderAdapter in main, register it at the composition root, and register its generic renderer provider. Do not add harness checks to AgentView or Workbench core. To add composer behavior, register a prompt menu, a prompt contributor, or a widget in the `agent.composer.toolbar` slot.

## Workspace files and source control

`WorkspaceRoots` in main lists the folders the renderer may read: persisted workspace paths, folders chosen in the add-workspace dialog, and worktrees created beside a workspace in `<workspace>-worktrees/`.

`WorkspaceFiles` serves `files:list`, `read`, `find`, `write`, `create`, `rename`, `trash`, `reveal`, `image`, `exists`, and `watch`:

- Every request is resolved with realpath and contained within its root, so `..` paths and escaping symlinks are rejected. New paths need an existing parent inside the root; rename and trash act on a symlink itself, never its target. Nothing is ever written under `.git`.
- Reads are capped at 2 MB, binary files are detected, and each read returns a content hash.
- Writes only replace the version that was opened (its hash): otherwise nothing is written and the disk version comes back. Saves to one file run one at a time, are written beside the file and renamed into place, and re-check the hash just before the rename. Text only, up to 2 MB.
- Trash uses the system trash (Electron's `shell.trashItem`, injected at the composition root).
- Name search is a bounded walk that skips `.git` and `node_modules`. Search inside files goes through the source-control provider.
- Watches are recursive, debounced, and shared per root, and ignore build output and git internals that don't change status. They are owned by the requesting window and released when it closes.

File tabs are editable. A single click opens a preview tab that the next single click replaces; a double click or an edit keeps it. Unsaved tabs show a dot, keep their text while hidden (`core/dirty-views.ts`, not persisted), and ask before closing. A clean tab reloads when the file changes on disk; a dirty one offers Reload or Keep mine. Tabs can be reordered by dragging and have a context menu that view types extend with `tabMenu`. ⌘P opens Go to File and ⇧⌘F searches inside files; both are application-menu accelerators sent on `app:menu-command`, so they work from a terminal too. File paths in a session's terminal output link to the file at that line.

The renderer shares one watch per root through `core/workspace-watch.ts`.

Source control sits behind `SourceControlProvider` (detect, status, commit-all, create worktree, branches, checkout, and optionally fileAt, ignored, and search), selected per root by `SourceControlService`. `GitSourceControlProvider` is the only adapter:

- It runs fixed git argument lists with `execFile`. No shell is involved, and no caller-supplied arguments are accepted beyond validated branch names, commit messages, relative paths, and search text (always after `-e`).
- It parses `status --porcelain=v2 -z`.
- Checkout refuses while there are uncommitted changes; remote branches become local tracking branches.
- `fileAt` shows a file at HEAD or at the merge base with the default branch (origin's HEAD, else `main`, else `master`). The ref is never taken from the renderer. Changes open as diffs in the file tab.
- Search is `git grep` over tracked and untracked files, capped at 500 matches or 2 seconds; a newer search cancels the last.

Core and the renderer see only the generic `sourceControl` API and types.

## Validation

`npm test` covers adapter launch contracts and model arguments, ANSI redraws, prompt controls, multiline and chunked paste, protocol input, Plan mode switching in both directions, first-prompt readiness, recorded Codex and Claude transcripts, delayed paste acknowledgment, native draft collisions, concurrent delivery, approval races at command/paste/Enter stages, status/interrupt transitions, owner isolation, replay, process exit, and missing executables.

`npm test` also covers the prompt-option DSL and assembly order, state migration, workspace file containment and safe writes, terminal path links, and the Git adapter (porcelain parsing, commit, worktrees, checkout, fileAt, ignored, search) against temporary repositories.

After `npm run build`, `npm run qa:composer` runs deterministic Electron checks against an isolated simulated CLI, a temporary Git repository, and isolated app persistence. It covers:

- the three-pane shell and nested sessions;
- the launcher with a new worktree;
- the Persona and Instructions menus, including a conditional option and a migrated instruction;
- the exact composed prompt, the folder it was delivered in, and the model and effort it launched with;
- restarting with a different model after a prompt;
- the title taken from the first prompt;
- quote, preview, and recall;
- uncertain delivery handoff;
- the Files tree, search, and editing and saving a file;
- Source control: opening a change as a diff, and commit;
- Active views and tab overflow;
- layout persistence across restart. Screenshots are saved in the printed temporary directory.

`node scripts/qa-electron.mjs --plan` sends harmless no-tools planning checks to installed CLIs, twice to cover an already-planning session. Native account/permission gates remain untouched and are reported as unverified. Use `--claude-only` to target Claude during diagnosis.

`npm run build && node scripts/qa-electron.mjs` runs Electron QA with isolated Workbench persistence. Set `QA_SEND=1` for a harmless live Codex response, or `QA_CLAUDE_SEND=1` for Claude delivery (requires native authentication and uses the user's CLI account). The Claude check follows the native workspace trust flow; it never selects a billing/model-credit option. No application account or API key is introduced.

Verified locally on macOS: Codex CLI 0.155.1 native startup, multiline send/response, and planning submissions from normal and already-planning sessions (native mode indicator and response checked). Claude Code 2.1.280 recognizes the planning prefix with its native argument hint; delivery reaches its model/usage-credit choice. That account choice was left untouched, so Claude's full response and resulting Plan mode remain unverified. Other operating systems also need live verification. Those checks predate the footer-driven mode switch; it is covered by transcripts recorded from Codex CLI 0.166 and Claude Code 2.1.319 (`tests/fixtures/`), not yet by a live run here. Both providers have deterministic screen/delivery tests. New CLI versions and terminal input modes such as Vim mode may produce Unknown; direct terminal interaction remains available.
