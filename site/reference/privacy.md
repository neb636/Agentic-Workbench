# Data and privacy

DimSum runs on your computer and has no account. It sends no telemetry.

## Network use

DimSum itself connects to the network only to read your [plan usage](/guide/ai-usage-resources), using the credentials the CLI already has. Everything else on the network is done by the agent CLIs, under their own settings and terms.

## What is stored where

| Data | Location |
| --- | --- |
| Workspaces, open views, layout, drafts, prompt history and personas | `workbench-state.json` in your DimSum profile |
| Attachments | `attachments/<view>/` in your profile |
| Workspaces you trusted | `execution-trust.json` in your profile |
| Your instructions, settings and extensions | `~/.dimsum/` |
| A workspace's shared and local configuration | `<workspace>/.dimsum/` |
| Agent conversations | Wherever each CLI keeps them, managed by the CLI |

On macOS the profile is `~/Library/Application Support/DimSum` (`DimSum Dev` when you run from source). Set `WORKBENCH_USER_DATA_DIR` to use a different folder.

DimSum used to be called Agent Workbench. The first time it starts without a profile, it copies the old one (`Agent Workbench`, or `agent-workbench` from source) so your workspaces, views, draft attachments and trusted workspaces carry over, with saved attachment paths pointing into the new folder. The old folder is left in place; delete it once you no longer run the old app.

If the copy fails, DimSum shows the profile paths and the error, then stops. Fix the reported problem and restart to retry the migration; the old profile stays in place.

## Cleaning up

- **Settings ▸ General ▸ Remove attachments for closed views** deletes attachment copies you no longer need.
- **Settings ▸ General ▸ Reset workspace execution trust** forgets the workspaces you trusted.
- Quit DimSum and delete the profile folder to start over completely.
