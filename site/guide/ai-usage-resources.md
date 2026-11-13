# AI usage and resources

## Plan usage

The usage meter in the status bar shows how much of each agent subscription you have used: the current session window (5 hours), the weekly window, and credits where the plan has them. A meter turns to a warning color as you get close to a limit.

Click the meter for details. The popover has **Compact** and **Detailed** views and a **Refresh** button.

Reading usage doesn't send a prompt and doesn't spend anything.

- **Claude Code** usage is read with the credentials Claude Code already has (from `CLAUDE_CONFIG_DIR` if you set it) and refreshed every 15 minutes.
- **Codex** usage is refreshed every 10 minutes.

Turn the meter off, or hide one of the CLIs, under **Settings ▸ General ▸ AI usage**.

## Resource Manager

The Resource Manager in the status bar opens a window with two tabs:

- **Sessions** lists the running agent CLIs and terminals, grouped by workspace. Sessions that no longer have an open view are grouped under *No open view*, and **End all** stops them.
- **Resources** shows how much CPU and memory DimSum and its processes are using. **Refresh** measures again.
