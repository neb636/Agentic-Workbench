# Source control

The Source control panel works with Git repositories. Its badge shows how many files have changed.

## Changes

Changed files are listed under **Changes** and **Staged Changes**. You can stage, unstage and discard each file, and open any change as a diff. Discarding a new, untracked file deletes it, so DimSum asks first.

## Committing

Write a message and choose **Commit**, **Commit & Push**, **Commit & Sync** or **Commit & Publish**. You can also **Amend Last Commit**.

**Generate commit message** asks your Default CLI (set in [Settings](/configure/settings)) to write the message from the staged changes. **Preview AI changes** shows exactly what will be sent to the CLI before you send it.

## Syncing and other actions

The panel's actions menu has:

- **Sync**, **Pull**, **Pull (Rebase)**, **Push** (or **Publish Branch** for a new branch), **Fetch** and **Fetch (Prune)**;
- **Stage All**, **Unstage All**, **Discard All** and **Undo Last Commit**;
- **Stash** and **Stash (Include Untracked)**;
- **Continue** or **Abort** for a merge, rebase, cherry-pick or revert that stopped on a conflict.

DimSum never force-pushes.

## Branches and worktrees

From the branch picker you can switch branches, create, delete, merge or rebase a branch, and open or create a worktree. Agent sessions started in a **New worktree** get their own branch in a folder next to the workspace (`<workspace>-worktrees/`), so several agents can work at once without getting in each other's way.

## History and stashes

**History** lists recent commits, with **Load more** for older ones. Open a commit to see the files it changed, each as a read-only view, or revert it. **Stashes** can be applied, popped or dropped.

## Trust

Some Git actions run your repository's hooks, filters and helpers. DimSum asks you to [trust the workspace](/guide/trust) before the first one runs.
