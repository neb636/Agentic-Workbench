---
name: ship
description: Open or update a pull request for a change in this repo and handle Codex's automated review of it (watch, verify each finding, fix or push back, ask for one re-review). Use whenever you commit work and open or update a PR.
---

# Ship: open the PR and handle Codex's review

## 1. Open the PR

- Work on your branch, commit with clear messages, `git fetch origin main` (rebase if needed).
- Before pushing: `npm run typecheck`, `npm run lint`, and the focused QA from `AGENTS.md`.
- Open it ready for review (not a draft) with a body that summarizes the change; never merge it yourself:

```
gh pr create --base main --title '<title>' --body-file body.md
```

## 2. Watch Codex's review

Codex reviews every PR on open and on each push. Right after pushing, watch once in the background (Monitor tool;
silent until it prints, stops by itself after 7 minutes):

```
node scripts/watch-codex-review.mjs --pr <n>
```

It prints `CLEAN`, `FINDINGS` (one block per comment), `NOREVIEW`, `TIMEOUT` or `CLOSED`.

## 3. Handle each finding (the user never sees these)

1. **Verify first**: read the code and reproduce the claim before changing anything.
2. Reply on its thread (`gh api repos/{owner}/{repo}/pulls/<n>/comments/<id>/replies -f body=...`):
   - **Real:** fix it, re-run checks, push, reply `Fixed in <sha>: <what changed>`, react 👍
     (`gh api repos/{owner}/{repo}/pulls/comments/<id>/reactions -f content=+1`).
   - **Not real:** reply `Not an issue: <the evidence>`.
   - **Too nitpicky** (style preference, overstated severity, tiny bounded cost whose fix adds code): react 👎
     (`-f content=-1`) and reply `Not worth it: <why>`. A crash, lost data, a leak or a feature that doesn't work
     as built is never nitpicky.
   - **Needs the user's call:** say so in one line in your final message.
3. **One round only:** after a pushed fix, comment `@codex review` once with a line on what changed, then stop.
