import { _electron as electron } from "playwright";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

// Live smoke: uses existing CLI authentication, no tools/files requested.
// Billing, login, trust, and permission decisions are never automatically accepted.
const directory = await mkdtemp(join(tmpdir(), "workbench-native-plan-"));
await writeFile(join(directory, "workbench-state.json"), JSON.stringify({
  workspaces: [{ id: "qa", name: "Planning QA", path: process.cwd(), activeViewId: "codex", views: [
    { id: "codex", workspaceId: "qa", type: "agent", title: "Codex plan", state: { providerId: "codex.cli" } },
    { id: "claude", workspaceId: "qa", type: "agent", title: "Claude plan", state: { providerId: "claude.cli" } },
  ] }], activeWorkspaceId: "qa", personas: [{ id: "p", name: "Test persona", instructions: "Do not use tools or change any files.", description: "Read-only integration check", scope: "global" }],
  selectedPersonaByWorkspace: { qa: "p" }, appendedInstructions: [{ id: "i", workspaceId: "qa", content: "Keep the response brief.", enabled: true }],
}));
const app = await electron.launch({ args: ["."], env: { ...process.env, STUDIO_REPO_ROOT: process.cwd(), WORKBENCH_USER_DATA_DIR: directory } });
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(10_000);
  await page.evaluate(() => { globalThis.planningQAEvents = []; globalThis.workbench.agent.onEvent((event) => globalThis.planningQAEvents.push(event)); });
  for (const provider of process.argv.includes("--claude-only") ? ["Claude"] : ["Codex", "Claude"]) {
    await page.getByRole("tab", { name: new RegExp(`${provider} plan`) }).click();
    await page.getByRole("button", { name: "Start session", exact: true }).click();
    await page.getByRole("textbox", { name: "Prompt", exact: true }).waitFor();
    await page.waitForTimeout(4000);
    for (let turn = 1; turn <= 2; turn++) {
      const status = await page.locator(".composer-feedback").innerText();
      if ((await page.locator(".mode-select button").innerText()).trim() !== "Plan") {
        await page.locator(".mode-select button").click();
        await page.getByRole("option", { name: /^Plan/ }).click();
      }
      await page.getByRole("textbox", { name: "Prompt", exact: true }).fill(`Integration check ${turn}.\nAre you in Plan mode? If yes, reply exactly WORKBENCH_PLAN_OK_${turn}. Otherwise reply NOT_IN_PLAN_MODE.`);
      if (!await page.getByRole("button", { name: "Send for planning", exact: true }).isEnabled()) {
        console.log(provider, "BLOCKED before send:", status);
        await page.screenshot({ path: join(directory, `${provider}-${turn}-blocked.png`), scale: "css" });
        break;
      }
      await page.getByRole("button", { name: "Send for planning", exact: true }).click();
      await page.waitForTimeout(5000);
      for (let poll = 0; poll < 6 && (await page.locator(".session-pill").innerText()).toLowerCase().includes("working"); poll++) await page.waitForTimeout(5000);
      const terminal = await page.locator(".xterm-rows").innerText();
      const feedback = await page.locator(".composer-feedback").innerText();
      const draft = await page.getByRole("textbox", { name: "Prompt", exact: true }).inputValue();
      console.log(provider, "turn", turn, JSON.stringify({ feedback, draftRetained: Boolean(draft), terminal }));
      const snapshot = await page.evaluate(async () => globalThis.workbench.agent.attach(globalThis.planningQAEvents.at(-1).sessionId));
      await writeFile(join(directory, `${provider}-${turn}.json`), JSON.stringify(snapshot));
      await page.screenshot({ path: join(directory, `${provider}-${turn}.png`), scale: "css" });
      if (draft) {
        assert.match(terminal, /usage credits|sign in|log in|trust|Enter to confirm/i, "Unexpected delivery failure; inspect the recorded screen.");
        console.log(provider, "native account/decision gate left untouched; full response unverified.");
        break;
      }
      assert.match(terminal, /plan mode/i, "Native Plan mode indicator is missing.");
      assert.match(terminal, new RegExp(`(?:•|⏺)\\s*WORKBENCH_PLAN_OK_${turn}`), "Native agent did not confirm planning.");
    }
  }
} finally { await app.close(); console.log("Native planning artifacts:", directory); }
