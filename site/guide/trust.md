# Workspace trust

Some things DimSum does run code that comes from the repository, not from DimSum. Before the first of these runs in a workspace, DimSum asks **Trust workspace?**:

- Source-control actions, which can run Git hooks, filters and configured helpers.
- AI change preparation, such as generating a commit message.
- Workspace extensions in `<workspace>/.dimsum/extensions/`, which run inside the app with the same access the app has.

Only trust repositories you know. DimSum remembers your answer for that folder and for its worktrees in `<workspace>-worktrees/`.

Trust in DimSum doesn't change what the agent CLIs may do. Claude Code and Codex keep their own approval prompts, and those still decide what the agent can run.

## Resetting trust

**Settings ▸ General ▸ Reset workspace execution trust** forgets every workspace you have trusted and stops their workspace extensions. Running agent sessions keep their own permissions. DimSum asks again the next time it needs trust.

Your own extensions in `~/.dimsum/extensions/` don't need trust, because they are yours. See [Extensions](/extend/).
