# Agent Workbench engineering invariants

- This repository is a generic, local Agent Workbench. It is not a Codex-specific coding application.
- Workbench core must not depend on Codex, Claude, Devin, GitHub, Git, Snowflake, Data Vault, or any other concrete integration. Integration-specific behavior belongs behind adapters.
- First-party features use the same registries, commands, slots, prompt contributions, and provider seams intended for later extensions.
- A View is persisted UI state; a Session is a runtime resource. They are separate concepts, and not every View needs a Session.
- Agent command construction, configuration, and native event parsing belong to the provider adapter. Generic views consume only AgentProvider/AgentSession APIs.
- All AI use outside agent sessions goes through `InternalAiService` (`src/main/internal-ai/`). It is the only surface the app may use for AI: nothing else may send a prompt to an agent CLI for an app feature or call an AI API, and the renderer gets purpose-specific IPC, never a generic run-a-prompt channel. Its guard against repeated requests stays in front of every send. Reading a subscription's plan usage sends no prompt and spends nothing, so it is not AI use; it happens only in the self-contained AI usage feature (`src/main/ai-usage/`).
- Process and PTY lifecycle belongs outside React components. React may acquire a session controller and must dispose it on unmount.
- Privileged Node and Electron capabilities remain in the main process and are exposed to the renderer only through narrow, typed preload APIs. Never expose arbitrary process execution.
- Use accessible/headless primitives for common interactions instead of rebuilding focus, keyboard, selection, dialog, menu, or tooltip behavior.
- Product styling consumes semantic `--wb-*` theme variables. Feature components must not add literal product colors.
- `src/sdk` (`@dimsum/sdk`) is the contract between the workbench and everything that extends it. It holds types and pure builders only, and may import only `react` types and pure `src/shared` modules (ESLint enforces this). Implementations belong to `src/renderer/core`, `src/renderer/extensions` and `src/main`. First-party features register through the same `ExtensionContext` that workspace extensions get.
- Configuration and extensions are layered: `~/.dimsum/` (the person's own), `<workspace>/.dimsum/` (checked in) and `<workspace>/.dimsum/*.local.json` (personal, never committed). Folder and file names come from `src/shared/app-identity.ts`. Workspace extensions run only in a trusted workspace. `src/sdk/GUIDE.md` is the agent-facing guide: update it whenever the SDK changes.
- Prefer the smallest abstraction supported by current needs or explicitly planned consumers. Do not create speculative plugin frameworks or future infrastructure; leave a clean extension seam instead.
- Keep the application local-first unless a feature explicitly requires an external service.
- Preserve working architectural boundaries. Refactor only when a concrete requirement makes the current boundary inadequate.
- Do not add unit tests to this repository. Verify changes with type checking, linting, builds, and focused QA as appropriate.
- QA defaults to the simulated CLI and recorded transcripts. Use a real CLI session only when the behavior depends on the real CLI's timing or screen and cannot be observed otherwise. Real sessions use only the cheapest model for each harness (today Claude Code `haiku` at `low`, Codex `gpt-6-luna` at `low`), send short prompts that use no tools, and never accept billing, login, or trust prompts. Say in the pull request what ran live and why.

# Pull requests and Codex review

- Open pull requests ready for review, with a body that summarizes the change. Never merge them yourself.
- Codex reviews every PR. Follow `.agents/skills/ship/SKILL.md` (also `.claude/skills/ship`): watch with
  `node scripts/watch-codex-review.mjs --pr <n>`, verify each finding, fix it or push back on its thread, then ask for
  one re-review with `@codex review`. Handle findings yourself; don't hand them to the user.
- Codex command approvals live in `.codex/rules/commands.rules` (allow, prompt-to-reviewer, forbidden); extend that file rather than prompting.
