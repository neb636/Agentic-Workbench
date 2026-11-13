# Environment variables

Set these before you start DimSum.

| Variable | What it does |
| --- | --- |
| `WORKBENCH_CLAUDE_PATH` | Full path to the `claude` executable, if DimSum doesn't find it on `PATH` or in the usual install folders. |
| `WORKBENCH_CODEX_PATH` | Full path to the `codex` executable. |
| `WORKBENCH_USER_DATA_DIR` | Use a separate DimSum profile folder, for example to try something out without touching your real workspaces and drafts. |
| `DIMSUM_HOME` | Use a different folder in place of `~/.dimsum` for your own configuration and extensions. |
| `CLAUDE_CONFIG_DIR` | Claude Code's own setting. DimSum respects it when reading Claude plan usage. |

```sh
WORKBENCH_USER_DATA_DIR="$HOME/dimsum-scratch" npm run dev
```

## Inside sessions and terminals

DimSum sets these in every terminal and agent session it starts, so scripts and agents can find their way around:

| Variable | Value |
| --- | --- |
| `DIMSUM_HOME` | Your `~/.dimsum` folder (or the folder `DIMSUM_HOME` pointed to). |
| `DIMSUM_GUIDE` | The path to the extension guide for agents, the same text as the [SDK guide](/extend/sdk). |
