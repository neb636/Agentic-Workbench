---
title: What is DimSum
---

# What is DimSum

DimSum is a local workbench for working with coding agents. It runs the agents you already use, such as Claude Code and Codex, in their own native command-line interfaces, and adds a prompt composer, a file editor, source control and room for your own tools around them.

On disk DimSum keeps your own configuration in `~/.dimsum` and a workspace's in `.dimsum/`.

## How it works

Each agent session is the real CLI running in a terminal. DimSum doesn't replace the agent's interface or talk to a model on its own. The composer underneath writes your prompt into that terminal, so the CLI keeps its own permissions, slash commands, approvals and menus.

Around the sessions, DimSum gives you:

- **Workspaces**: folders you work in, each with its own sessions, terminals and open files.
- **A composer**: drafts, attachments, personas and instructions that shape a prompt before it is sent.
- **Files and source control**: an editor, search, diffs, commits, branches and worktrees.
- **Extensions**: TypeScript files that add views, panels, composer menus and checks before a prompt is sent. The app reloads them as you save.

## Local first

Everything runs on your computer. Drafts, layout and attachments stay in your profile. DimSum has no account and sends no telemetry. The only network traffic is what the agent CLIs do themselves, plus reading your plan usage for the [usage meter](/guide/ai-usage-resources).

## Where to start

- [Install DimSum](/install), then [start your first session](/first-session).
- Learn the [workbench layout](/guide/workbench) and the [composer](/guide/agent-sessions).
- Share instructions with your team through [configuration files](/configure/config-files).
- [Write an extension](/extend/) to add your own views and checks.
