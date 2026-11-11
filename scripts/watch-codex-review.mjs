// Waits for Codex's review of a PR's latest commit, prints what it found, and exits.
// Meant to run under Claude Code's Monitor tool: silent while waiting, so it costs no context until it prints.
//   node scripts/watch-codex-review.mjs --pr 30 [--timeout 420] [--interval 20]
// Output lines (each one wakes the session): FINDINGS (then one block per inline comment), CLEAN, NOREVIEW, TIMEOUT.
// Codex keeps one summary comment on the PR with a machine-readable state (status + commit_sha); inline findings
// are ordinary PR review comments. Typical review time: 1-2 minutes after a push; the timeout is 3.5x that.
import { execFileSync } from 'node:child_process'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : fallback
}
const pr = arg('pr')
if (!pr) {
  console.error('usage: watch-codex-review.mjs --pr <number> [--timeout 420] [--interval 20]')
  process.exit(2)
}
const timeoutS = Number(arg('timeout', 420))
const intervalS = Number(arg('interval', 20))

const gh = (...args) => JSON.parse(execFileSync('gh', args, { encoding: 'utf8' }) || 'null')
const api = (path) => gh('api', '--paginate', '--slurp', path).flat()
const isCodex = (c) => /codex/i.test(c.user?.login ?? '')

const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000))
const started = Date.now()

while (true) {
  try {
    const head = gh('pr', 'view', pr, '--json', 'headRefOid,state')
    if (head.state !== 'OPEN') {
      console.log(`CLOSED PR #${pr} is ${head.state}; stopped watching.`)
      break
    }
    const summary = api(`repos/{owner}/{repo}/issues/${pr}/comments`).find(
      (c) => isCodex(c) && c.body.includes('codex-pull-request-review-summary'),
    )
    const refused = api(`repos/{owner}/{repo}/issues/${pr}/comments`).find(
      (c) => isCodex(c) && c.body.includes('To use Codex here'),
    )
    if (refused && !summary) {
      // Codex answered with a setup notice instead of reviewing, so no review is coming
      console.log(`NOREVIEW Codex declined to review PR #${pr}: "${refused.body.replace(/\s+/g, ' ').slice(0, 160)}"`)
      break
    }
    const state = summary && JSON.parse(summary.body.match(/codex-review-state:v1 (\{.*?\}) -->/s)?.[1] ?? 'null')
    const review = state?.code_review
    if (review?.status === 'completed' && review.commit_sha === head.headRefOid) {
      const short = head.headRefOid.slice(0, 7)
      if (!review.has_any_findings) {
        console.log(`CLEAN Codex reviewed ${short} on PR #${pr}: no findings.`)
        break
      }
      // Findings can sit on an earlier commit's thread after a follow-up push, so look at every Codex thread
      // that nobody has replied to yet, not only the ones on the current commit.
      const all = api(`repos/{owner}/{repo}/pulls/${pr}/comments`)
      const answered = new Set(all.filter((c) => !isCodex(c) && c.in_reply_to_id).map((c) => c.in_reply_to_id))
      const open = all.filter((c) => isCodex(c) && !c.in_reply_to_id && !answered.has(c.id))
      console.log(
        `FINDINGS Codex reviewed ${short} on PR #${pr} and reports findings: ${open.length} unanswered comment(s).` +
          (open.length ? '' : ' None found as inline threads; read the Codex summary comment on the PR.'),
      )
      for (const c of open) {
        const where = c.commit_id === head.headRefOid ? '' : ` [earlier commit ${c.commit_id.slice(0, 7)}]`
        console.log(`--- ${c.path}:${c.line ?? c.original_line}${where} (comment id ${c.id})\n${c.body.replace(/<[^>]+>/g, '').trim()}`)
      }
      break
    }
  } catch (e) {
    // transient gh/network errors: keep trying until the timeout
  }
  if ((Date.now() - started) / 1000 > timeoutS) {
    console.log(`TIMEOUT No finished Codex review of PR #${pr} after ${timeoutS}s; stopped watching.`)
    break
  }
  await sleep(intervalS)
}
