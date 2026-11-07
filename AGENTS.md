# Kaylee Gamepack Studio

This folder is the local Electron builder app for the game in the parent directory. It was imported from
`~/repos/agent-workbench` and is now maintained here. It is intentionally tailored to this game.

- Follow the root AGENTS.md for family privacy, character identities, art, game changes and validation.
- Keep Electron dependencies and builds isolated here. The published game must not import native APIs or this renderer.
  The one shared dependency is `src/shared/labs.ts`, a dependency-free protocol and numeric validator.
- Layout: work list | the middle | explorer. Everything in the middle is a tab, one on screen: agents, terminals, the game and each lab (one `game` view type, `GameViewState.lab`), files. The explorer on the right (⌘⌥B) holds Files, Changes, Sections and Ship. The game tabs share one running game per piece of work (`useGameLive.liveView`); the last one shown stays mounted hidden. Its servers start with the first game tab and stop a minute after the last closes.
- Reuse the live game labs; do not fork their controls, character renderer or camera implementation. They are tabs over the one game pane (`features/game/`), each opening the section on screen with its lab on.
- File tabs edit: never save over a file that changed on disk since the tab opened it (`files.write` checks the hash); the renderer never names a path outside the selected worktree, and main checks every read, write and search.
- One game server per piece of work (`GameServerPool`, last 2 kept, trimmed to the one on screen after 3 minutes unless comparing with main).
- Performance (Dad's Mac has 8 GB): the game pane slows to ~8 fps behind other apps (`src/world/labs/studio-pace.ts`, `{ studioFocused }`),
  the 3D engine caps at 30 fps and 1.5x pixels under `?studio=1`. Keep git off the idle path: the Work list polls only while Studio is in
  front with at most 3 git processes at once, file watches drop build output and `.git` noise (`isWatchedChange`), agent output goes out
  once per frame. New work clones main's `node_modules` (`cp -c`) when the lockfile matches. Measure with `scripts/perf-sample.mjs`. The Sections tree comes from the checkout's own `scripts/sections-index.mjs`; never import game source here.
- Native processes belong in main, behind typed preload APIs. Only the top frame receives native capabilities.
  Lab messages must match the exact local origin and iframe source. Never accept arbitrary executable paths or shell commands from lab output.
- AI tuning previews bounded numbers only. Reject stale replies and unknown/non-finite controls atomically. Preserve Undo.
  A separate, reviewable agent prompt saves the chosen numbers in the game; do not silently edit source when previewing.
- Character concepts follow ../docs/3d-characters.md: one image, same character, one change. Keep photos, meshes and .blend scratch data private outside the repo.
- Tripo is a manual handoff. Do not auto-spend credits. Blender work uses the user's configured CLI/MCP and preserves the existing rigid-pivot Rig.
- Semantic `--wb-*` CSS variables; reuse the inherited accessible controls and CLI/session lifecycle.
- `npm run build` checks both TypeScript projects. `npm test` here runs Node contract tests (not the game’s prohibited local Playwright suite).
- Launch from the root with `npm run studio`; it owns both loopback servers and Electron and stops them together.

- `npm run studio:dist:dir` builds a macOS app. The packaged renderer is independent of the opened repository; Git branches/worktrees choose the editable checkout. The game pane lazily starts that piece of work's Vite server using Electron’s bundled Node runtime. Keep the renderer/game origins exact and stop owned servers on quit.
