# Installation

DimSum runs on macOS (Apple silicon). Other operating systems haven't been tested.

::: warning No downloadable release yet
There are no published builds yet. For now, build DimSum from source.
:::

## Requirements

- macOS on Apple silicon.
- [Node.js](https://nodejs.org/) 24 and npm.
- Xcode Command Line Tools (`xcode-select --install`), which are needed to build the native terminal module.
- At least one agent CLI, installed and signed in on its own:
  - [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (`claude`)
  - [Codex](https://github.com/openai/codex) (`codex`)

DimSum doesn't sign you in or ask for an API key. It runs the CLI you already use, with the account that CLI is already using.

## Run from source

```sh
git clone https://github.com/neb636/Agentic-Workbench.git
cd Agentic-Workbench
npm install
npm run dev
```

`npm install` rebuilds the terminal module for Electron, which can take a minute the first time. `npm run dev` opens the app with live reload.

## Build the app

```sh
npm run dist
```

This builds a DMG and an app bundle in `release/`, then opens `release/mac-arm64/DimSum.app`. It is signed ad hoc only, so macOS may ask you to confirm the first time you open it. To build only the app bundle, without a DMG, run `npm run dist:dir`.

## Finding the agent CLIs

DimSum looks for `claude` and `codex` on your `PATH` and in the usual install folders. If a CLI is somewhere else, point DimSum at it before you start the app:

```sh
WORKBENCH_CLAUDE_PATH=/opt/tools/claude npm run dev
```

See [environment variables](/configure/environment) for the full list.
