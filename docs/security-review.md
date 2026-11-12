# Security review and improvement plan

Implementation status and explicit deferrals: [security implementation](security-implementation.md).

Reviewed 2026-11-11 at commit `3a964ac937a0666153248d8b5b1a04e7592dd959`.

## Assessment

The most important risks are the old Electron runtime, execution triggered by apparently passive Git operations, inconsistent workspace authorization, and filesystem races. Fix these before describing workspace boundaries as a security guarantee or distributing the app more widely.

This is a source review with isolated executable probes and a live npm advisory lookup. It is not a penetration-test certification. No unauthenticated remote exploit or application XSS entry point was demonstrated. Several findings require hostile local workspace contents, configuration, concurrent filesystem changes, or JavaScript already running in the trusted renderer. Those prerequisites are stated below.

The main architectural distinction: **the trusted renderer can already obtain shell-equivalent authority through `pty.create` and `pty.input`.** A shell's working directory does not restrict the shell's filesystem access. Narrow IPC types and root checks protect individual APIs; they do not sandbox a compromised trusted UI. Keep all repository data, terminal output, images, and future remote content outside that trust boundary. A requirement to contain a fully compromised trusted renderer would require a separate execution-authorization boundary, beyond the fixes proposed here.

## Scope and method

Reviewed the Electron window and preload, all main-process IPC registrations and schemas, filesystem and undo/redo operations, persistence and attachments, PTY/session lifecycle and prompt delivery, source control, built-in AI, model discovery, AI usage and credentials, repository instructions, renderer content sinks, build configuration, and lockfile.

Checked current Electron, Git, and Claude documentation and advisories where behavior or support status matters. Ran repository functions against synthetic files and disposable Git repositories under `/private/tmp`; no real credentials or project files were used as probe targets. No real agent CLI, model prompt, login, billing, or trust interaction ran.

The checkout has no installed dependencies (`npm ls --depth=0` reports unmet dependencies). Full application type checking, linting, builds, Electron UI QA, dependency exploit reproduction, and packaged-binary inspection were not performed. The report and evidence are the only repository changes.

The temporary probes used Node 24.15.0's `stripTypeScriptTypes({ mode: "transform" })` to execute the current TypeScript implementations. Git executable resolution and status-line dependency imports were replaced with isolated fixture equivalents. Race probes controlled the interleaving or clock to demonstrate unsafe behavior deterministically; they do not measure an attack's success probability. Git probes used Apple Git 2.54.0 with global/system configuration disabled.

## Trust boundaries

| Input or resource | Current authority | Security objective |
| --- | --- | --- |
| App renderer and preload | Can request files, native dialogs, Git actions, agent sessions, and interactive shells | Only the registered app document receives the bridge; never render executable untrusted content there |
| Workspace files and repository instructions | Text/images become UI content and prompt contributions | Data cannot silently become host execution, broader file access, or hidden changes to personal policy |
| Repository configuration | Git may invoke monitors, filters, hooks, credential helpers, and transports | Browsing is safe before execution trust; intentional operations preserve expected behavior after trust |
| Provider CLI | Runs as the user's OS account with inherited environment and native permissions | Launch only the configured adapter; preserve native approval gates; accurately describe its authority |
| Main process | Full local privileges, native image decoding, credential reads | Authenticate requests, enforce scope and budgets, isolate processing of hostile inputs |
| Built-in AI | Sends a bounded diff through a provider CLI | Show scope/provider, minimize secrets, prevent repeated spending, expose purpose-specific IPC only |
| Local app storage and distribution | Drafts, attachments, usage payloads, executable application | Private permissions, bounded retention, signed and verifiable release artifacts |

## Findings by priority

Priority P0 means the first remediation batch; P1 means the next batch; P2 means planned hardening. Severity reflects impact with the stated prerequisite, not likelihood of an internet attack.

| ID | Priority / severity | Finding | Evidence |
| --- | --- | --- | --- |
| S01 | P0 / High | Unsupported Electron with relevant published security fixes missing | Lockfile, npm audit, vendor advisory |
| S02 | P0 / High | Passive Git status and AI preparation execute repository-configured programs without Workbench execution trust | Executable fixture probes |
| S03 | P0 / High | File save follows a precreated temporary symlink; reads have a check/use race | Deterministic executable probes |
| S04 | P1 / High | Git operations and AI context exceed an approved workspace subfolder | Executable fixture probes |
| S05 | P1 / Medium | UI persistence can mint filesystem authorization; worktree and agent checks are inconsistent | Source trace plus root/symlink probes |
| S06 | P0 / High hardening gap | Trusted UI is unsandboxed, has no CSP, and IPC authenticates frame position rather than app identity | Source review |
| S07 | P1 / Medium | Main-process regex evaluation and uncapped work can freeze or exhaust the app | Regex timeout probe plus source review |
| S08 | P1 / Medium | AI secret filtering and provider/data-scope disclosure are incomplete | Source review |
| S09 | P2 / Medium | Sensitive local storage has inconsistent privacy and retention controls | Source review |
| S10 | P1 / Medium | Distribution uses ad hoc signing and disables hardened runtime | Build configuration; binary not inspected |

### S01 — Update Electron and affected dependencies

`package-lock.json` resolves Electron **38.8.6**, Vite **7.3.6**, and Zod **4.6.5**. Electron 38 reached end of life on March 10, 2026. The current schedule lists 43–45 as supported stable majors on the review date. Electron's support policy covers its latest three stable majors. [Electron schedule](https://releases.electronjs.org/schedule), [support policy](https://www.electronjs.org/docs/latest/tutorial/electron-timelines).

The audit reports **22 affected packages: 2 critical, 8 high, 12 moderate**. These are package-level propagated counts, not 22 independent exploitable defects. The two critical entries are `shell-quote` and its dependent `concurrently`, in development tooling. Current `dev` commands are fixed strings; no attacker-controlled route into the vulnerable quoting pattern was found.

Electron is listed under `devDependencies` but is the shipped application runtime. Its prototype-hijack advisory specifically concerns Promise-returning `contextBridge` APIs and can escalate to Node access in an unsandboxed renderer if untrusted JavaScript executes there. Workbench uses that bridge pattern and `sandbox: false`. This review did not demonstrate the required untrusted-JavaScript entry point. [Electron vendor advisory](https://github.com/electron/electron/security/advisories/GHSA-h7rp-cf8h-j98x).

Zod is a production dependency used for IPC and repository data validation. The registry reports its locked version affected by oversized-collection memory exhaustion, with 4.6.6 as the fix floor. Treat that as an advisory match, not a locally reproduced crash. Vite and the remaining transitive findings need development/build-path triage; offscreen rendering, extension, and custom-protocol advisories are not automatically reachable in this app. See the accompanying [audit evidence](security-review-evidence.json) for versions, affected nodes, and advisory links.

**Change:** choose a current supported Electron patch after compatibility review, update the lockfile and affected direct/transitive dependencies, and inspect changes rather than applying `npm audit fix --force`. The audit suggests some downgrades; do not accept those blindly. Updating Electron within `^38.1.0` cannot reach a supported major.

**Done when:** a fresh advisory report has no unexplained runtime high/critical matches; toolchain exceptions identify prerequisites and an expiry; native `node-pty` rebuild, packaged launch, clipboard, images, session lifecycle, and simulated CLI QA pass on the selected runtime.

### S02 — Separate repository inspection from execution trust

Evidence: `src/main/providers/git-source-control-provider.ts:185`, `:427`, `:443`, `:498`. All commands inherit Git configuration; `GIT_OPTIONAL_LOCKS=0` and `GIT_TERMINAL_PROMPT=0` do not disable executable helpers. `status()` can invoke `core.fsmonitor`. `pendingChanges()` runs `git add --all` into a scratch index, which can invoke clean/process filters before the AI request guard or CLI sandbox is involved. [Git's configuration reference](https://git-scm.com/docs/git-config#Documentation/git-config.txt-corefsmonitor).

**Confirmed:** a fixture `core.fsmonitor` command wrote a harmless marker during `provider.status()`. A fixture clean filter wrote another marker during `provider.pendingChanges()`. No commit or AI session was required. An ordinary remote clone does not import another user's `.git/config`; an exploit needs a supplied local repository/configuration, a configured global filter activated by repository attributes, or another way to influence executable configuration. Native Git behavior is expected after trust; the problem is treating passive inspection as safe before that decision.

**Change:** add a small main-owned workspace execution-trust policy. Adding a folder grants browsing, with execution requiring an explicit trust decision. Have the Git adapter provide a safe inspection mode: suppress fsmonitor, hooks, external diff/textconv, and other executable configuration applicable to each command. Do not run staging/filter pipelines merely to describe changes before trust. Use read-only file/index inspection or refuse that operation until trust. Preserve hooks, filters, signing, credentials, and transports for intentional operations in trusted repositories.

Keep Git-specific switches inside the Git adapter. The core should ask for inspection or execution permission, not understand Git settings. Persist trust separately from arbitrary renderer UI state. Define invalidation for changed root identity and execution-relevant configuration. Do not equate ownership checks such as Git's `safe.directory` with a decision to execute repository programs.

**Done when:** opening, watching, searching, or viewing history of an untrusted fixture never runs its monitor/filter/hook; AI preparation does not execute filters before trust; trusted user-initiated Git workflows retain their expected native behavior.

### S03 — Close filesystem check/use races and unsafe temporary writes

Evidence: `src/main/workspace-files.ts:90`, `:162`, `:190`, `:211`; `src/main/file-operations.ts:72`, `:83`. Canonical-path validation is followed by fresh path-based operations. Another writer can replace an entry or ancestor between those operations. Save creates a predictable `<file>.workbench-<pid>-<timestamp>` with `fs.writeFile` using its default overwrite/follow behavior.

**Confirmed:** precreating that temporary filename as a symlink caused a legitimate save to overwrite a synthetic file outside the workspace. The probe fixed the clock to make the name deterministic. A second probe swapped the file to a symlink immediately before `fs.open`; `read()` returned the first six bytes of an outside canary, using the original file's size. These are local concurrent-writer attacks, not attacks possible from immutable repository text alone.

**Change first:** create save temporaries exclusively with random names in an exclusively created private staging directory on the destination filesystem, use safe file handles and explicit modes, and never follow an existing temporary entry. Clean up on every failure. Preserve conflict detection without claiming it is an atomic compare-and-swap against external writers.

**Change next:** design one file-access boundary for reads, writes, image loads, transfers, rename, trash, and undo/redo. Anchor operations to validated directory identities. `O_NOFOLLOW` protects a final component on supported platforms; it does not solve ancestor-directory replacement. Strong containment against an adversarial concurrent writer may require descriptor-relative native operations or an OS-isolated file broker. Choose and document that guarantee explicitly; another `realpath()` check alone does not establish it. Audit attachment/cache directories for the same class of issue.

**Done when:** precreated temporary symlinks are rejected without touching their targets; forced leaf and ancestor swaps never disclose or overwrite outside canaries for operations claiming strict containment; failures preserve original data and remove only app-owned staging entries.

### S04 — Keep Git actions and AI context inside the selected scope

Evidence: `src/main/providers/git-source-control-provider.ts:155`, `:185`, `:202`, `:272`, `:427`; `src/main/ipc.ts:151`. A directory inside a larger repository passes provider detection. `status` reports repository-wide paths; staging uses `:(top,literal)` pathspecs, commit uses `add --all`, and AI preparation uses repository-wide staging and `:(top)` diff selection. Checking the process working directory does not constrain those operations.

**Confirmed:** with only `repo/approved-subfolder` selected as the workspace, `status()` listed a sibling file, `stage()` staged that sibling, and `pendingChanges()` included its synthetic secret in the AI-bound diff. No actual model request was sent.

**Change:** resolve repository top-level and the workspace prefix inside the adapter. Scope file actions and AI context to the approved prefix. Repository-wide actions such as commit, reset, stash, checkout, and branch operations need explicit repository-level authority, or a clearly disclosed decision to expand the workspace. In particular, a commit can include previously staged sibling changes even if a new `add` was scoped. Make the main process enforce this policy and return scope metadata for the UI.

**Done when:** a selected subfolder cannot stage, discard, commit, or send sibling changes to AI without separately granted repository scope. Full-repository and worktree workflows still work, with the scope visible before an irreversible action or outbound AI request.

### S05 — Make workspace grants main-owned and consistent

Evidence: `src/main/ipc.ts:152`, `:162`, `:338`, `:356`; `src/shared/schemas.ts:15`, `:159`; `src/main/workspace-files.ts:59`, `:67`, `:84`; `src/main/agent-session-manager.ts:93`.

`persistence.save` accepts arbitrary workspace paths and calls `roots.replace` with them. Saving UI state can therefore authorize an unrelated directory without the native picker. `WorkspaceRoots.resolve` checks the lexical worktree-container path, then returns `realpath` without checking whether the canonical result remains in the canonical container. Every descendant of `<workspace>-worktrees` is accepted, not just worktrees the app registered. Agent creation forwards `workspacePath` directly to PTY spawn, whereas ordinary terminal creation calls `roots.directory`.

**Confirmed:** an initially rejected outside root became readable after `roots.replace([outside])`, matching the persistence handler's authorization effect. A symlink under `workspace-worktrees/escape` pointing to an outside directory also allowed reading its canary without modifying the root list. The persistence endpoint itself was traced statically; an Electron IPC exploit was not run.

**Change:** persist grants in a main-owned store and let UI snapshots reference stable workspace IDs. Authorize new roots only through the existing native picker or the successful main-process worktree-creation path. Register exact canonical worktree roots and revalidate identity on use. Use the same resolver for agent, terminal, file, and source-control requests; keep View IDs separate from runtime/session authorization. Remove grants and associated watches when a workspace is removed.

**Impact limit:** these changes enforce the documented file/API boundary. They do not stop an already compromised renderer from using an authorized interactive shell to access the host.

**Done when:** both asynchronous and synchronous saves cannot add or mutate grants; symlinked containers/children cannot escape; agents reject outside working folders; legitimate restored workspaces and newly created worktrees work through a documented migration.

### S06 — Harden the trusted UI and authenticate IPC senders

Evidence: `src/main/index.ts:72`, `:86`, `:91`, `:111`; `src/main/ipc.ts:105`, `:115`, `:167`; `src/preload/index.ts`; `index.html`.

Context isolation is enabled and Node integration is disabled, but renderer sandboxing is explicitly off. There is no CSP, permission request/check policy, or explicit download policy. Production loads `file://`. IPC rejects subframes but accepts any sender's top frame, without checking the registered `WebContents` or expected app origin/document. The development URL environment override is honored even when packaged. Existing top-level navigation and popup-denial controls reduce exposure, but do not substitute for sender authentication.

**Change:** register the app's permitted `WebContents` and exact production document/origin; use one guard for invoke, event, and synchronous channels. Reject null/destroyed frames, foreign windows, unexpected documents, and untrusted subframes. Restrict the development URL to unpackaged mode and the intended loopback endpoint. Cover navigation, redirects, subframes, webview attachment, and downloads explicitly. Keep external URL dispatch limited to parsed HTTP(S) URLs and deliberate user actions.

Enable sandboxing after bundling the preload: the current TypeScript CommonJS build imports local shared modules, which a sandboxed preload cannot simply `require` as before. No renderer feature needs a general Node capability. Move production assets to a narrowly mapped standard custom app protocol after upgrading Electron; reject traversal and avoid exposing arbitrary disk paths. Ensure the selected protocol's CORS/security options match the patched runtime.

Set a restrictive production CSP: scripts from the app only, no eval/inline scripts, no remote connections, images from app/data only, no frames/objects/forms, and no base URL changes. Accommodate CodeMirror and UI style injection deliberately; do not weaken script policy for CSS. Give Vite a separate loopback-only development policy. Deny unused permissions in both request and check handlers; preserve clipboard actions deliberately.

These controls follow [Electron's security guidance](https://www.electronjs.org/docs/latest/tutorial/security). They reduce entry points and browser-exploit impact; they do not remove the intentional shell authority of trusted app JavaScript.

**Done when:** the packaged app reports sandboxing enabled, works without CSP violations for supported flows, denies IPC from a second top-level window and subframes, cannot load remote code through a production environment override, and cannot access camera/microphone/geolocation or start downloads without an explicit product feature.

### S07 — Bound expensive work and move regex off the main thread

Evidence: `src/main/workspace-files.ts:297`, `:361`; `src/shared/schemas.ts:7`, `:35`, `:88`, `:146`; `src/main/ipc.ts:200`, `:338`; `src/main/pty-manager.ts:59`; `src/main/prompt-attachments.ts:40`.

Fallback search evaluates JavaScript regexes in Electron main. Its two-second check happens between files, so it cannot interrupt a single catastrophic match. **Confirmed:** searching a 33-character line with `^(a+)+$` exceeded a three-second subprocess deadline and had to be killed. This requires regex search on a matching hostile/accidental input; it is not a remote unauthenticated endpoint.

Other availability gaps: persisted state has unconstrained view/state arrays and recursive conditions; terminal input strings and session creation have no application-level budgets; attachments have a per-file limit but no storage quota; file indexing bounds file count rather than directories/time; transfer fingerprinting and PTY parser queues have no clear work/backpressure budget. Individual existing caps are useful but do not bound concurrent total work.

**Change:** execute regex search in a terminable worker/process, or use a documented non-backtracking regex engine. Enforce byte/count/depth limits before expensive schema validation where possible, then validate in bounded batches. Add per-owner session, attachment-byte, in-flight operation, watcher, and terminal-output budgets; apply backpressure rather than silently dropping protocol bytes. Put timeouts, cancellation, and process-group cleanup around Git and background CLI helpers; many Git calls currently use timeout `0`.

**Done when:** pathological regex returns a timeout while the UI stays responsive; oversized/nested state and repeated IPC requests fail within bounded resources; noisy fixture CLIs and hanging Git helpers can be stopped without leaving processes or corrupting state.

### S08 — Make outbound AI scope and secret handling explicit

Evidence: `src/main/providers/git-source-control-provider.ts:31`, `:443`; `src/main/internal-ai/commit-message.ts:7`, `:51`; `src/main/internal-ai/internal-ai-service.ts:90`; `src/renderer/features/source-control/SourceControlPanel.tsx:124`.

The excluded filename patterns cover `.env*`, `*.pem`, and `*.key`. They do not cover credentials in ordinary source/config files, key containers with other extensions, or arbitrary secrets. Git clean filters can transform content before exclusion. The scratch index also creates temporary copies/objects for excluded files before their diff is omitted. A missing explicit provider falls back to the first installed supported provider; the UI label may say only “Generate commit message.” The generated result stays editable and is not automatically committed, which limits prompt-injection impact.

**Change:** fix S04 first. Show the effective destination provider and change scope before the first outbound request, with an inspectable bounded preview and staged-only option. Persist that preference so routine use does not acquire repeated modal friction. Apply conservative secret detection/redaction before sending; make exclusions configurable and state their limits. Avoid staging known-excluded secrets into scratch storage, use private scratch permissions, and clear it on success/failure. Resolve an unspecified provider explicitly in the purpose-specific flow. Keep all sends and repeat guards in `InternalAiService`; do not introduce generic renderer prompt IPC.

**Done when:** synthetic `.env`, JSON-token, private-key, ordinary-source-secret, and sibling-scope fixtures never appear in the outbound prompt under the configured policy; provider/scope match the preview; failures send nothing; generated text requires user review before commit.

### S09 — Protect local drafts, caches, attachments, and usage payloads

Evidence: `src/main/persistence.ts:45`, `:57`; `src/main/prompt-attachments.ts:40`, `:51`, `:72`; `src/main/ai-usage/sources/claude-statusline.ts:14`; `src/main/ipc.ts:124`; `src/renderer/state/workbench-store.ts:196`.

Attachments are written with mode `0600`, which is good. State and cache writes rely on inherited permissions; drafts and personal instructions are persisted as plaintext. Attachment removal from a composer does not remove the stored bytes, and retention deletes folders only for views absent at a later load. A long-lived view can retain all historical attachments. The usage wrapper writes the entire status-line payload when it includes rate limits, retaining additional session/workspace metadata the meter does not need. Preview reads are not bounded after a stored attachment is changed externally. Main also decodes user-controlled image bytes through `nativeImage`.

**Change:** use `0700` app-private directories and `0600` sensitive files where supported, including migrations for existing storage. Keep private staging and exclusive writes. Store only usage fields the meter needs. Add visible storage/retention controls with a clear explanation that CLI conversation storage is managed separately. Keep files needed by active sessions; prune orphaned and expired attachments safely. Bound bytes and decoded dimensions before previews and move hostile image processing out of main where practical. Avoid logging payloads, tokens, or user content.

Encryption at rest is an optional product decision after access control and retention. Use OS-backed storage for future app-owned secrets; do not copy CLI credentials into the workbench state or claim encryption protects against same-user malware or a compromised trusted renderer.

**Done when:** storage permissions and cleanup survive restart/crash checks, removed-view data expires as documented, usage storage contains no unrelated session metadata, and oversized/modified image fixtures cannot exhaust main-process memory.

### S10 — Establish a hardened release path

Evidence: `package.json:70`, `:96`. The macOS target uses `identity: "-"` and `hardenedRuntime: false`. No signing/notarization/fuse policy or automated release/security workflow is checked into this repository. That does not establish whether an external release process exists; the built binary was not inspected.

**Change:** retain an explicit local-development packaging mode, and create a release mode with Developer ID signing, hardened runtime, narrowly justified entitlements for Electron/native PTY use, notarization, and verification of nested binaries. At package time, before signing, disable unused RunAsNode, NODE_OPTIONS, and CLI-inspection fuses and enable ASAR integrity/ASAR-only loading where compatible. Verify final values instead of relying on ASAR as encryption or an integrity boundary by itself. [Electron fuse guidance](https://www.electronjs.org/docs/latest/tutorial/fuses).

Use a reproducible lockfile install, reviewed dependency-update automation, artifact checksums, a small dependency inventory/SBOM, and a private security-reporting contact. If CI is added, pin third-party actions and keep release credentials limited to the signing job. There is no updater in the reviewed code; authenticate updates if one is later introduced, without adding an updater solely for this review.

**Done when:** a clean build produces a signature/notarization-verified package with inspected entitlements and fuses; tampering fails integrity checks; native sessions still run; release checks document runtime advisory status and the artifact's dependency inventory.

## Additional observations and verification gaps

- **Claude status-line composition:** `src/main/ai-usage/sources/claude-statusline.ts:48` reads project/local commands and wraps them into CLI `--settings`. The fixture confirmed that the resulting wrapper executes a project command. This is expected shell behavior, not shell-quoting injection. Claude's documentation explicitly retains a workspace-trust gate for status-line execution, so this review does **not** establish a trust bypass. Preserve the native gate and setting precedence; avoid independently promoting project commands unless their authority is clear. Check disabled-hooks, managed settings, changed project settings, and resumed sessions with a simulated adapter first. [Claude status-line trust documentation](https://code.claude.com/docs/en/statusline#workspace-trust-required).
- **Repository instruction provenance:** `src/shared/instruction-layers.ts:27` intentionally lets a shared instruction replace personal/global instructions with the same ID. That is a product behavior with a security consequence: a changed repository can replace personal text on the next send. Show changed shared contributions and their origin, and consider protecting personal precedence or requiring acknowledgement for a collision. Prompt text is not a security boundary; native provider approvals remain authoritative.
- **Environment and executable discovery:** `spawnTerminal` and built-in AI inherit the app environment; PATH discovery accepts executable candidates without a regular-file/absolute-directory policy. CLI executables, user shell startup files, and user-configured helpers are trusted code. Prefer stable absolute executable paths, reject relative PATH entries for automatic background discovery, and remove unnecessary Workbench/debug variables from children. Preserve provider authentication deliberately; blanket environment stripping can break expected sign-in.
- **Process termination:** PTY cleanup is thoughtful but a process-tree snapshot cannot guarantee containment of adversarial daemonization, PID reuse, or new descendants after enumeration. Model-listing and usage children kill only the immediate process. Use focused wrapper/grandchild fixtures, and qualify claims about stopping “everything.” This review did not reproduce orphaned descendants.
- **External file opening:** the explicit “Open in Default App” feature can launch active content via `shell.openPath`. Keep it user initiated and communicate active/executable file types. Do not invoke it automatically for repository output or use it as the generic image preview path.
- **Credentials/network:** usage tokens stay in main and the URL is fixed HTTPS with cookies omitted; no renderer token exposure or arbitrary-URL SSRF was found. Tighten response size/redirect policy as defense in depth. Verify that usage enablement cannot reset service backoff indefinitely via configure toggling.
- **Image/XSS claim limits:** SVG previews use `<img>` data URLs, not injected HTML; React text and CodeMirror are not raw-HTML sinks here. No `dangerouslySetInnerHTML`, eval, raw Electron bridge, webview, or remote-page viewer was found in product code. These are useful constraints to preserve, not proof that every Chromium decoder or renderer dependency is safe.

## Implementation sequence

Keep each change reviewable and preserve adapter boundaries. Estimates indicate relative effort for one engineer and exclude native cross-platform containment work and signing-account provisioning.

| Batch | Work | Dependencies | Effort | Exit condition |
| --- | --- | --- | --- | --- |
| 1 | S01 runtime/dependency updates; S03 exclusive private save staging | None | Medium | Relevant advisories triaged; temporary symlink overwrite closed; simulated QA passes |
| 2 | S06 app identity guard, packaged dev-URL rejection, preload bundling, sandbox, CSP and permissions | Runtime update | Medium | Only registered app documents invoke IPC; supported UI works under enforced policy |
| 3 | S05 authoritative grants, exact worktrees, shared cwd authorization | Sender policy | Medium | UI snapshots cannot grant roots; all services use consistent authorization |
| 4 | S02 execution trust and safe inspection; S04 repository/subfolder scope | Grants | Large | Opening an untrusted repository runs no repository code; subfolder authority holds |
| 5 | S08 outbound AI preview, provider resolution, secret policy and private preparation | Scope and safe Git preparation | Medium | Synthetic sensitive fixtures stay out of prompts; repeat guards remain centralized |
| 6 | S07 budgets, cancellable regex, helper cleanup; S09 storage/preview limits | Can follow batches 1–3 incrementally | Medium–large | Resource-pressure and crash cleanup QA passes |
| 7 | S10 signed release and ongoing advisory verification | Runtime and packaged hardening | Medium plus provisioning | Final distributed binary passes security inspection |

Treat batches 1–4 and the release checks as gates for broader distribution or claims of safe handling of untrusted repositories. Batch 2 can initially add CSP to the current packaged page; a custom-protocol migration may be a separate change after the runtime upgrade. Strict protection against adversarial ancestor replacement in S03 needs its own design decision and validation rather than an optimistic patch.

## Focused QA plan

Use the simulated CLI and synthetic local repositories. Add focused QA scripts/fixtures as changes land; do not add unit tests. Run `npm run typecheck`, `npm run lint`, and `npm run build` for implementation changes, followed by relevant existing composer, context-menu, source-control, resource, AI usage, and send-selection QA.

| Scenario | Required outcome |
| --- | --- |
| Foreign top frame, subframe, navigated document, stale document | All privileged channels reject; owned sessions are cleaned up |
| Save/saveNow inserts outside root | UI state can change, authorization cannot |
| Worktree/container symlink, removed root, outside agent cwd | Rejected before filesystem/process work |
| Leaf/ancestor swap; precreated save temporary; collision during rename/undo | No outside read/write; originals survive; app-owned cleanup only |
| Workspace inside larger Git repository | Sibling content/actions stay out of granted scope, including already staged files |
| Monitor, filter, hook, remote helper in untrusted repository | No execution during inspection; intentional execution requires trust |
| Synthetic secrets, hostile diff instructions, unspecified AI provider | Preview/policy matches actual destination and prompt; no automatic commit or tool use |
| Oversized state, deep prompt conditions, pathological regex, repeated sessions/attachments, high-output CLI | Bounded rejection or cancellation; UI/main remain responsive |
| CLI wrapper/grandchild, hung Git helper, reload/crash/close | Lifecycle policy met, resources reclaimed, limitations recorded |
| Modified/large/compressed images and attachments | Bounded read/decode, no main crash, no orphaned sensitive data |
| Packaged app with production policy | No remote-code override; sandbox/CSP/permissions/fuses/signature verified |

Only use a live CLI if the remaining question depends on its real timing/screen and cannot be answered with the fixture or recorded transcripts. Follow `AGENTS.md`: shortest no-tools prompts, cheapest configured model/low effort, never accept login/billing/trust prompts, and record exactly what ran live and why. In particular, native status-line trust behavior remains unverified here; do not automate accepting its trust dialog to close that gap.

## Recorded probe results

| Probe | Observed result |
| --- | --- |
| Outside root before/after the same `roots.replace` used by persistence | Rejected before; `OUTSIDE_FIXTURE_CANARY` readable after |
| Symlinked worktree child | `OUTSIDE_FIXTURE_CANARY` readable |
| File swapped at open after validation | Outside bytes `OUTSID` returned |
| Predictable save temporary precreated as outside symlink | Outside canary became `OUTSIDE_WAS_OVERWRITTEN` |
| Git selected subfolder | Sibling listed and staged; sibling synthetic secret included in pending AI diff |
| Passive Git fsmonitor | Harmless marker written |
| Pending-change clean filter | Harmless marker written |
| Project status-line wrapper | Project command output `PROJECT_COMMAND_EXECUTED`; native CLI gate not exercised |
| Main fallback regex | Child exceeded 3,000 ms; forcibly terminated |

The [machine-readable evidence](security-review-evidence.json) preserves these results and the audit snapshot summary. Temporary probe source and fixtures were kept under `/private/tmp` during the review; they are not a permanent regression suite. No application fixes have been applied by this review.
