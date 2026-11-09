# Agent Workbench engineering invariants

- This repository is a generic, local Agent Workbench. It is not a Codex-specific coding application.
- Workbench core must not depend on Codex, Claude, Devin, GitHub, Git, Snowflake, Data Vault, or any other concrete integration. Integration-specific behavior belongs behind adapters.
- First-party features use the same registries, commands, slots, prompt contributions, and provider seams intended for later extensions.
- A View is persisted UI state; a Session is a runtime resource. They are separate concepts, and not every View needs a Session.
- Agent command construction, configuration, and native event parsing belong to the provider adapter. Generic views consume only AgentProvider/AgentSession APIs.
- All AI use outside agent sessions goes through `InternalAiService` (`src/main/internal-ai/`). It is the only surface the app may use for AI: nothing else may send a prompt to an agent CLI for an app feature or call an AI API, and the renderer gets purpose-specific IPC, never a generic run-a-prompt channel. Its guard against repeated requests stays in front of every send.
- Process and PTY lifecycle belongs outside React components. React may acquire a session controller and must dispose it on unmount.
- Privileged Node and Electron capabilities remain in the main process and are exposed to the renderer only through narrow, typed preload APIs. Never expose arbitrary process execution.
- Use accessible/headless primitives for common interactions instead of rebuilding focus, keyboard, selection, dialog, menu, or tooltip behavior.
- Product styling consumes semantic `--wb-*` theme variables. Feature components must not add literal product colors.
- Prefer the smallest abstraction supported by current needs or explicitly planned consumers. Do not create speculative plugin frameworks or future infrastructure; leave a clean extension seam instead.
- Keep the application local-first unless a feature explicitly requires an external service.
- Preserve working architectural boundaries. Refactor only when a concrete requirement makes the current boundary inadequate.
- QA defaults to the simulated CLI and recorded transcripts. Use a real CLI session only when the behavior depends on the real CLI's timing or screen and cannot be observed otherwise. Real sessions use only the cheapest model for each harness (today Claude Code `haiku` at `low`, Codex `gpt-6-luna` at `low`), send short prompts that use no tools, and never accept billing, login, or trust prompts. Say in the pull request what ran live and why.
