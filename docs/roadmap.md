# Roadmap: from workbench to DimSum

The long-term goal is a starter framework for agentic workspaces in Electron apps. Working name: **DimSum**. It would provide:

- typed registries, events and hooks;
- custom views and extensions;
- the guide, CLI and skills that let agents understand the app and extend it.

It is too early to extract a library. The goal now is to make extraction mechanical when the time comes.

## Where the seams are today

| Seam | Location | Becomes |
| --- | --- | --- |
| Contracts and builders | `src/sdk` (`@dimsum/sdk`). It imports only `react` types and pure `src/shared` modules, and ESLint enforces that. | The published SDK package |
| Host implementation | `src/renderer/core`, `src/renderer/extensions` | The framework's renderer runtime |
| Main-process services | `src/main/config-layers.ts`, `src/main/extensions/` | The framework's main runtime |
| Product features | `src/renderer/features/*`, activated as built-in extensions | The starter app built on the framework |
| On-disk identity | `src/shared/app-identity.ts` | Configuration of the framework |

## Ideas taken from Rex (and what we deliberately do differently)

[Rex](https://www.superlogical.com/rex/docs) informed the design.

What we took:

- **One action surface.** A typed command can be called from menus, keys, agents and (later) a CLI.
- **Notification-only events plus a few explicit interception points.** Rex lets only key handlers consume input. Here, only send guards can refuse a send.
- **Visible provenance through namespaced ids.** Extensions prefix their ids with their folder name.
- **Keep the last good config when a reload fails.**
- **A guide that ships with the app,** so upgrading refreshes what agents know.
- **Environment variables** that tell an agent where it is (`DIMSUM_HOME`, `DIMSUM_GUIDE`).

What we do differently:

- **TypeScript-first composition with small builder functions, not Lua and config-as-script.**
- **Layering.** Rex has one global `init.lua`. Here, configuration layers: user (`~/.dimsum`), checked-in workspace (`.dimsum/*.json`) and personal workspace (`.dimsum/*.local.json`).
- **Custom UI.** Extensions contribute React views, panels and widgets. Rex has no custom UI surface.

## Next steps

1. **Personas in layers.** Move personas from app state to `~/.dimsum/personas.json` and `.dimsum/personas(.local).json`, with the same migration pattern instructions use.
2. **Port the Kaylee Gamepack views into `.dimsum/extensions`.** The game pane, lab, image generator and ship panel. Each needs a host capability added as a narrow, typed seam, not a generic escape hatch:
   - managed long-lived local dev servers: declared by the extension, started by main, origin returned;
   - iframe embedding of an origin the extension owns, which needs a CSP `frame-src` allowance and a `postMessage` channel;
   - purpose-specific AI through `InternalAiService`, for example the lab's "propose bounded numeric changes". The renderer still never gets a generic run-a-prompt channel;
   - running a fixed command in a named terminal view.
3. **A `dimsum` CLI** that talks to the running app over a local socket, like `rex api list` / `describe` / `call`. Commands and their argument schemas would be listable and callable by agents.
4. **Program status from agents.** A terminal escape sequence (Rex uses OSC 7501) that lets a CLI report `working`/`blocked`/`done` with a message, shown as view status.
5. **Command argument schemas.** Give `ctx.commands.register` an optional schema, so the palette, the CLI and agents can validate and describe commands.
6. **Extraction.** Move `src/sdk` into its own package, publish its types instead of copying them into `.dimsum/.sdk`, and turn the host folders into the framework runtime.
7. **The full rename.** Change the product name, bundle id, userData folder and `WORKBENCH_*` environment variables to DimSum. All on-disk names already come from `app-identity.ts`.
