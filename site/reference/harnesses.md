# Harnesses

A harness is the program an agent session runs. DimSum runs each one as its real interactive CLI and never in a headless mode, so the CLI's own interface, permissions and approvals all still apply.

| Harness | Id | Executable |
| --- | --- | --- |
| Claude Code | `claude.cli` | `claude` |
| Codex | `codex.cli` | `codex` |
| Local terminal | `terminal.local` | Your shell (`$SHELL`) |

Use the ids in [instruction conditions](/configure/config-files#conditions) and in extensions, for example to show an option only for Claude Code.

## Claude Code

- Model and effort come from the composer's pickers and are passed to `claude` when it starts.
- Attachment folders are passed with `--add-dir`, so Claude Code can read attached files.
- **Plan** mode uses Claude Code's own plan mode.

## Codex

- Runs `codex` interactively.
- **Plan** mode uses Codex's own `/plan`.

## Signing in

Install each CLI and sign in to it outside DimSum. DimSum never handles your account, and it never accepts sign-in, billing or trust prompts for you. If a CLI isn't found, see [Installation](/install#finding-the-agent-clis).
