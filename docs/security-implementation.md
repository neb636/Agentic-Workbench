# Security implementation

Implemented from the November 11 review. The original review is a historical baseline, not a statement that its findings remain unchanged.

## Scope

At the user's request, repository-wide Git scope and all symlink-related containment/race protections are deferred. Existing symlink/worktree handling and Git subfolder semantics remain in place. Native terminals and agents retain their OS-user authority and provider-native approvals.

## Changes

- Electron 45.3.1, Zod 4.6.7, patched tooling and lockfile. Targeted minimatch overrides for electron-builder, universal packaging and the TypeScript parser remove the remaining reported build-tool advisories. UI library versions remain at the original locked versions to avoid an unrelated UI upgrade. Re-run lint and packaging when removing these overrides after upstream releases catch up.
- Bundled sandbox-compatible preload, renderer sandboxing, production CSP and a custom `workbench://app` origin serving only built assets. Production ignores the development URL override; development uses the configured loopback endpoint. The app refuses webviews, frame navigation, redirects and downloads. Only registered app documents can call IPC. Unused browser permissions are denied; clipboard access remains available to the trusted app.
- UI saves can no longer introduce arbitrary workspace roots. Native directory selection remains the route for new workspaces. Agent working directories now use the terminal directory resolver. Removed workspaces revoke the in-memory roots after save. This is API authorization, not a sandbox for interactive shells.
- Passive Git inspection disables fsmonitor and hooks before execution trust. Source-control mutations, remote refreshes and AI preparation require a remembered native Workbench trust decision. Trust is main-owned, separate from renderer state, and can be reset in Settings. Derived worktrees inherit workspace trust. Trust applies to the repository and its evolving configuration; it is not a hash-based approval of each subsequent hook/configuration edit. Native agent trust dialogs remain untouched.
- Optional **Preview AI changes** shows the bounded, filtered request without sending a model prompt. The UI names the provider and repository-wide scope. Credential filename exclusions and conservative content redaction supplement each other; they cannot recognize every possible secret. Known excluded files are omitted from scratch staging. Generated commit messages remain editable and are never committed automatically.
- Regex fallback search reuses one terminable worker per search with a one-second per-file deadline and memory budget. IPC input has count/depth/size budgets before recursive schema validation. Filesystem indexing bounds directories as well as files; per-window terminal/agent creation is capped at 256. PTY parsing applies pause/resume backpressure instead of dropping protocol output. Background usage/model-listing helpers run in independent process groups and terminate those groups.
- Both save paths validate the serialized UTF-8 size before writing; oversized existing profiles are preserved and block saves with an explicit startup error. Autosave failures are visible in the app. State is stored with private permissions, and saves use distinct staging filenames to prevent concurrent saves from sharing a temporary. Attachment directories are private, preview bytes are bounded, total attachment storage is capped at 5 GB, and Settings can remove data for closed views. Cleanup preserves views touched during the current process to protect unsaved drafts; some newly closed-view data can remain until restart. It refuses destructive cleanup if saved state cannot be validated.
- The usage status-line wrapper stores rate-limit fields rather than the full session payload, uses private permissions and bounded input, and preserves the native status-line command/trust flow. It needs an installed Node executable; if unavailable, scheduled usage reads still work. Usage requests reject redirects.
- Packaged apps disable RunAsNode, NODE_OPTIONS, CLI inspection, and extra renderer file-protocol privileges; enable ASAR integrity and ASAR-only loading. Local packaging remains ad hoc for development. `npm run release` requires Developer ID and Apple notarization credentials, enables hardened runtime/notarization, and produces a production dependency SBOM plus artifact checksums/runtime inventory. It does not publish or upload a release to repository hosting.

## Verification

Recorded on 2026-11-11: type checking, lint, production build, focused security QA, composer, source-control, commit-message, AI-usage, context-menu, resource, confirmation-dialog and selection-to-agent QA passed. All agent interactions used simulated CLIs; no live model prompts or native agent trust decisions ran. UI suites were rerun after fixing keyboard context-event propagation and branch-picker loading readiness. The npm audit snapshot reports zero vulnerabilities; see [audit result](security-implementation-audit.json).


Run `npm run typecheck`, `npm run lint`, `npm run build`, and `npm run qa:security`. The focused security QA uses synthetic local repositories and no real agent CLI. It checks sandboxing, foreign-window IPC rejection, root grant rejection, passive fsmonitor suppression, trust cancellation, production CSP, and pathological-regex cancellation.

Existing simulated QA covers source control, commit-message generation, AI usage, context menus, resources, selection-to-agent and composer flows. QA fixtures preseed Workbench execution trust for their own disposable repositories; this grants no trust to user repositories and accepts no native CLI trust prompts. Keyboard checks allow the terminal/tab focus handoff to settle before native key dispatch.

The final ad hoc package passed launch smoke, signature verification, ASAR manifest integrity verification and inspection of all configured fuse values. The production launch smoke also confirmed that a remote development-URL environment override is ignored.

Before release, inspect fuses and verify the final signature:

```sh
npx @electron/fuses read --app "release/mac-arm64/Agent Workbench.app"
codesign --verify --deep --strict "release/mac-arm64/Agent Workbench.app"
```

Developer ID signing/notarization requires `CSC_NAME`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`. The local ad hoc package verifies packaging behavior but does not establish notarized distribution readiness. Do not share a development package as a verified signed release.

A pinned-action macOS CI workflow and weekly dependency-update configuration are included. These workflows have not been executed on the remote hosting service in this session.

## Remaining limits

- Git scope and symlink protections are intentionally deferred.
- The trusted renderer intentionally retains interactive shell authority. CSP and sender checks protect entry points; they cannot contain arbitrary JavaScript already executing in that trusted UI.
- Secret filtering is heuristic. The preview is an inspectable snapshot; files may change before a subsequent generation.
- Thumbnail/icon decoding now runs in a disposable sandboxed renderer with no preload/network permissions, PNG/JPEG validation, a five-second deadline, and pixel/output limits. Host-wide memory pressure from malicious image compression remains possible; process isolation is not an OS memory quota.
- Trust is repository-level and persists until reset. Root identity changes invalidate stored trust; configuration changes within a trusted repository do not. Finer helper permission policies, and OS-level containment of adversarial daemonization are not implemented.
- Windows-specific job-object cleanup and packaged signing behavior were not verified on this macOS checkout.
- Developer ID/notarization verification awaits release credentials. Local signature and fuse checks do not substitute for it.
