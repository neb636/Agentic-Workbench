import { _electron as electron } from "playwright";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { setTimeout } from "node:timers";

if (process.argv.includes("--plan")) {
  await import("./qa-native-planning.mjs");
  process.exit(0);
}

// QA inventory: picker, native startup, split, draft, tab switch, resume,
// close/exit, missing executable, and minimum window layout. Isolated app data.
const directory = await mkdtemp(join(tmpdir(), "workbench-cli-qa-"));
await writeFile(join(directory, "workbench-state.json"), JSON.stringify({
  workspaces: [{ id: "qa", name: "CLI QA", path: process.cwd(), activeViewId: "codex", views: [
    { id: "codex", workspaceId: "qa", type: "agent", title: "Codex QA", state: { providerId: "codex.cli" } },
    { id: "claude", workspaceId: "qa", type: "agent", title: "Claude QA", state: { providerId: "claude.cli" } },
  ] }], activeWorkspaceId: "qa", personas: [], selectedPersonaByWorkspace: {}, appendedInstructions: [],
}));
let app = await electron.launch({ args: ["."], env: { ...process.env, STUDIO_REPO_ROOT: process.cwd(), WORKBENCH_USER_DATA_DIR: directory } });
try {
  const page = await app.firstWindow();
  await page.evaluate(() => { globalThis.qaAgentEvents = []; globalThis.workbench.agent.onEvent((event) => globalThis.qaAgentEvents.push(event)); });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.getByRole("button", { name: "Start session", exact: true }).waitFor();
  await page.screenshot({ path: join(directory, "picker.png") });
  await page.getByRole("button", { name: "Start session", exact: true }).click();
  await page.getByRole("textbox", { name: "Prompt", exact: true }).waitFor();
  await page.waitForTimeout(4000);
  if (process.env.QA_SEND) {
    await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("Reply with exactly WORKBENCH_OK.\nDo not use tools or change any files.");
    await page.getByRole("button", { name: "Send prompt", exact: true }).click();
    await page.waitForTimeout(15000);
    console.log("SEND", await page.locator(".composer-feedback").innerText(), "draft:", await page.getByRole("textbox", { name: "Prompt", exact: true }).inputValue());
    assert.equal(await page.getByRole("textbox", { name: "Prompt", exact: true }).inputValue(), "");
    assert.match(await page.locator(".xterm-rows").innerText(), /WORKBENCH_OK/);
    await page.screenshot({ path: join(directory, "sent.png") });
  }
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("Draft survives a tab switch\nSecond line");
  assert(await page.getByRole("button", { name: "Send prompt", exact: true }).isEnabled());
  await page.screenshot({ path: join(directory, "codex.png") });
  console.log("CODEX", await page.locator(".session-pill").innerText());
  await page.getByRole("tab", { name: /Claude QA/ }).click();
  await page.getByRole("button", { name: "Start session", exact: true }).click();
  await page.getByRole("textbox", { name: "Prompt", exact: true }).waitFor();
  await page.waitForTimeout(4000);
  console.log("CLAUDE", await page.locator(".session-pill").innerText());
  if (process.env.QA_CLAUDE_SEND) {
    if ((await page.locator(".xterm-rows").innerText()).includes("Yes, I trust this folder")) {
      await page.locator(".xterm-helper-textarea").focus();
      await page.keyboard.press("Enter");
      await page.waitForTimeout(3000);
    }
    if ((await page.locator(".xterm-rows").innerText()).includes("Try the new fullscreen renderer?")) {
      await page.locator(".xterm-helper-textarea").focus();
      await page.keyboard.press("Escape");
      await page.waitForTimeout(1500);
    }
    console.log("CLAUDE INPUT", await page.locator(".composer-feedback").innerText());
    await page.screenshot({ path: join(directory, "claude-ready.png") });
    await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("Reply exactly WORKBENCH_CLAUDE_OK.\nDo not use tools or change files.");
    await page.getByRole("button", { name: "Send prompt", exact: true }).click({ timeout: 5000 });
    await page.waitForTimeout(15000);
    console.log("CLAUDE SEND", await page.locator(".composer-feedback").innerText());
    await page.screenshot({ path: join(directory, "claude-sent.png") });
    const result = await page.evaluate(async () => globalThis.workbench.agent.attach(globalThis.qaAgentEvents.at(-1).sessionId));
    if (result.status.activity === "waiting-for-input" && result.screen.includes("usage credits")) {
      assert.match(result.screen, /WORKBENCH_CLAUDE_OK/);
      assert.notEqual(await page.getByRole("textbox", { name: "Prompt", exact: true }).inputValue(), "");
      console.log("Claude delivery verified; native model/usage-credit choice left untouched. Response not verified.");
    } else {
      assert.equal(await page.getByRole("textbox", { name: "Prompt", exact: true }).inputValue(), "");
    }
  }
  await page.screenshot({ path: join(directory, "claude.png") });
  await page.getByRole("tab", { name: /Codex QA/ }).click();
  assert.equal(await page.getByRole("textbox", { name: "Prompt", exact: true }).inputValue(), "Draft survives a tab switch\nSecond line");
  await page.getByRole("separator", { name: "Terminal height" }).focus();
  await page.keyboard.press("ArrowDown");
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 640));
  await page.waitForTimeout(500);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(directory, "minimum.png") });
  assert.match(await page.locator(".xterm-rows").innerText(), /Ask Codex|›/);
  const bounds = await page.locator(".agent-display, .composer-panel, .support-column, .composer-actions, .composer-feedback").evaluateAll((elements) => elements.map((e) => {
    const r = e.getBoundingClientRect(); return { width: r.width, height: r.height, bottom: r.bottom, right: r.right, viewportHeight: innerHeight, viewportWidth: innerWidth };
  }));
  assert(bounds.every((r) => r.width > 0 && r.height > 0 && r.bottom <= r.viewportHeight + 1 && r.right <= r.viewportWidth + 1));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 920));
  await page.getByRole("button", { name: "Manage personas" }).click();
  await page.getByRole("button", { name: "Create persona" }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("QA persona");
  await page.getByRole("textbox", { name: "Instructions", exact: true }).fill("Be concise.");
  await page.getByRole("button", { name: "Save persona" }).click();
  assert(await page.getByRole("button", { name: /QA persona/ }).isVisible());
  await page.getByRole("button", { name: "Delete persona" }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Create view" }).click();
  await page.getByRole("menuitem", { name: /Terminal/ }).click();
  await page.locator(".terminal-host .xterm-helper-textarea").focus();
  await page.keyboard.type("printf '\\127ORKBENCH_SHELL_OK\\n'");
  await page.keyboard.press("Enter");
  await page.getByText("WORKBENCH_SHELL_OK", { exact: true }).waitFor();
  await page.getByRole("tab", { name: /Codex QA/ }).click();
  assert.equal(await page.getByRole("textbox", { name: "Prompt", exact: true }).inputValue(), "Draft survives a tab switch\nSecond line");
  await page.getByRole("button", { name: "Close Codex QA", exact: true }).click();
  assert.equal(await page.evaluate(async () => {
    try { await globalThis.workbench.agent.attach(globalThis.qaAgentEvents[0].sessionId); return false; } catch { return true; }
  }), true);
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("Draft saved across restart");
  await page.waitForTimeout(350);
  assert.deepEqual(errors, []);
  await app.close();
  app = await electron.launch({ args: ["."], env: { ...process.env, STUDIO_REPO_ROOT: process.cwd(), WORKBENCH_USER_DATA_DIR: directory, WORKBENCH_CODEX_PATH: join(directory, "missing-codex") } });
  const restored = await app.firstWindow();
  await restored.getByRole("heading", { name: "Choose your coding harness" }).waitFor();
  assert(await restored.getByRole("radio", { name: /Codex/ }).isDisabled());
  const saved = await restored.evaluate(() => globalThis.workbench.persistence.load());
  assert.equal(saved.workspaces[0].views.find((view) => view.id === "claude").state.draft, "Draft saved across restart");
  if (process.env.QA_HOLD) await new Promise((resolve) => setTimeout(resolve, 45000));
} finally { console.log("QA artifacts:", directory); await app.close(); }
