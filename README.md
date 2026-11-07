> **This is the `kaylee` branch: Kaylee Gamepack Studio.** It lived in `neb636/Kaylee-Gamepack/workbench/` until
> PR #351 (Nov 2026), which moved the game to a review-first process and took the Studio out of the game repo. This
> branch is that folder as it was then (game commit `c4671d0`). It's parked, not maintained.
>
> **To run it again** against a Gamepack checkout: the game side of the lab bridge was removed in #351. The four files
> are in `game-bridge/` at their original paths; copy them back into the game (and re-add `useStudioBridge` in the feel,
> camera and character labs, and `useStudioLocation` in `App.tsx`) for the "Ask AI" lab tuning to work. Everything
> else (terminals, agents, files, source control, image gallery) works with any checkout. `npm ci && npm run dev` here.

# Kaylee Gamepack Studio

A local Electron app for building Kaylee’s Gamepack. The workbench source, Claude Code/Codex adapters, terminals,
file browser, source control and image gallery were imported from `~/repos/agent-workbench`. Nothing runs from that sibling repo.

From the game repo:

```sh
npm ci                       # game dependencies (if needed)
npm run studio:install       # isolated Electron dependencies + native PTY rebuild
npm run studio
```

The launcher compiles Electron, starts the studio renderer at `http://127.0.0.1:5175`, then opens Electron. It refuses an
occupied port. No game server runs until a game panel opens (ports 5174, 5176, 5178, 5180). Close the studio window, use Cmd+Q, or press Ctrl+C
in the launching terminal to stop the servers. Normal game development can still use port 5173. Node 22.12+ (24 recommended), npm, installed and signed-in `claude` and/or
`codex` CLIs are required for AI. Their existing login/config is used; the studio needs no API key of its own.

To build and open a macOS app (like agent-workbench's `dist:dir`), run from the game repo:

```sh
npm run studio:dist:dir
# Or build a DMG as well:
npm run studio:dist
```

The app is written to `workbench/release/mac-arm64/Kaylee Gamepack Studio.app` on Apple Silicon
(`release/mac/` on Intel). You can copy it to Applications and open it from Finder or the Dock.
`npm --prefix workbench run open:app` opens the last build again. Quit an already running Studio before rebuilding.
These are local, ad-hoc-signed builds, not notarized distribution builds.

Studio works on **one** Gamepack repo. The packaged app asks for your checkout once (**Open the Gamepack repo**) and
remembers it; source-run Studio uses the checkout it runs from. The left **Work** list shows main and every worktree
git knows about, wherever it lives (`.claude/worktrees/`, orca, `Kaylee-Gamepack-worktrees/`), named by branch, with
its PR (open, draft, merged, closed), CI and changed-file count from `gh` (sign in with `gh auth login`). Click one to
open its agent and views; its sessions nest under it.

- **+ New piece of work**: type a short name (`canada-whales`). Studio fetches main, makes the branch
  `<your GitHub login>/canada-whales` in `~/repos/Kaylee-Gamepack-worktrees/canada-whales` (a folder Claude Code and
  Codex share), copies main's `node_modules` there as an APFS clone (seconds, no extra disk) when the lockfile matches,
  otherwise runs `npm ci`, and opens an agent in it.
- **Finished** groups worktrees whose PR is merged or closed, or whose folder is gone. **Clean up…** (a row's ⋯ menu)
  or **Clean up all** removes the folder after asking. It never touches the main checkout, a worktree with changes, or
  commits that exist only on this Mac (unless the PR has exactly that head, as after a squash merge). Branches stay.
- Rows get **+ Claude** / **+ Codex** on hover, and a worktree without dependencies shows **npm ci ▸**.
- Personas are gone for now; Instructions stay in Settings.

**Layout.** Everything for the selected piece of work is a tab in the middle, one on screen at a time: agents,
terminals, **🎮 Game**, **🎥 Camera lab**, **🎛️ Feel lab**, **🦄 Character lab** and open files (the **+** menu lists
them; drag to reorder, right-click for Close others). The game tabs share one running game: the last one shown stays
loaded behind the agent, and going from one game tab to another reopens the game at that lab. ⌘G brings the game
forward. The **explorer** on the right (⌘⌥B) has **Files** (tree, search by name or inside files, ⌘P, ⇧⌘F),
**Changes** (a click shows the diff; commit), **Sections** and **Ship**. File tabs are editable: one click opens a
preview tab, ⌘S saves, and a file an agent changed reloads by itself or asks when you have edits. New agent tabs start
their CLI at once; type straight away.

Open a piece of work's Game tab (or one of its lab tabs) to start its live game server on a loopback port; it stops a
minute after the last game tab there closes. The built interface stays on port 5175,
so the labs retain their exact-origin checks. Quit Studio to stop both servers. Each checkout needs `npm ci` once
(use a Studio terminal), Node 22.12+ and your signed-in AI CLIs. If a branch is missing, run `git fetch` in its terminal
and reopen the sidebar. The app uses Electron’s bundled Node runtime for the game server. It doesn't bundle a game checkout, npm, AI CLIs or Blender; only changes to Studio itself
require rebuilding the `.app`. Game changes reload in the labs.

The main checkout opens with four Studio views (other work opens with an agent; add labs from its ⋯ menu):

- **3D character lab**: the actual lab, poses, voices, outfits, lineups and exports. Prepare a character builder prompt
  or open Character concepts. The game and its existing lab stay available on iPad and PR previews.
- **Camera lab**: paste any 3D section link. Choose frame/mode and freeze the moment using the existing controls.
  Explain the framing problem, choose Claude or Codex, and press **Ask AI & preview controls**. AI gets the current
  shot, lens, frame, section state and bounded controls. It does not see a screenshot; describe visual issues precisely.
- **Feel lab**: paste a section with knobs, play it, then describe the problem. AI gets that activity’s controls,
  their notes/source paths and a sample of watched input/output. It previews values in the running toy.
- **Character concepts**: generate one transparent vinyl A-pose concept, inspect it, then use **Refine from this**.
  A workflow selector prepares prompts for the Tripo handoff, four-mesh comparison, Blender split/rig and game QA.

Tuning results include an explanation and **Undo AI change**. Invalid or stale replies change nothing. Requests can
be cancelled and time out after three minutes. Keep the same scene, frame, mode and controls while a reply is pending.
**Prepare prompt to save in game** opens a normal Claude/Codex composer with the exact snapshot and your note; review
and send it there. Previewing alone never changes source defaults. The CLIs' regular permission/trust prompts appear
in their terminal for agent sessions and image orchestration.

Tripo generation/texturing is manual (no API/credits integration). Blender work uses the selected CLI’s configured
Blender MCP; the studio does not bundle Blender. Dad chooses family identity/animal, the final concept and winning
mesh. Read [the character recipe](../docs/3d-characters.md) for the full process.

Sources, generated images and studio state live under `~/Library/Application Support/Kaylee Gamepack Studio/`.
Family photos stay out of Git. Private mesh/.blend working files remain under
`~/repos/KayleeGamepack-planning-assets/models/<id>/`; only approved runtime GLBs enter the game repo.

```sh
npm --prefix workbench run qa:packaged # after dist:dir, with Studio closed; no model calls
npm run studio:check          # renderer/main build + Node contract tests
npm run verify                # normal game checks; no Electron install required in game CI
npm --prefix workbench run qa:labs  # with studio running; fixture CLIs, no model calls
npm --prefix workbench run qa:images # after studio:check; fixture concept workflow
```

Verified locally: both studio builds, 50 Node contracts, fixture Electron lab and concept flows, plus real Codex camera/steering requests. Claude returned its sign-in error on this machine; run `/login` in Claude Code to use it.

The migration plan is [planning/gamepack-studio.html](../planning/gamepack-studio.html). The upstream MIT license is
preserved in `LICENSE` (upstream commit `81610597caaa18e68fb17731b54a7513c9985064`). Build products, dependencies, releases and private scratch data are ignored by Git.
