import assert from "node:assert/strict";
import process from "node:process";
import test from "node:test";
import managerModule from "../dist-electron/main/agent-session-manager.js";
import codexModule from "../dist-electron/main/providers/codex-agent-provider.js";
import claudeModule from "../dist-electron/main/providers/claude-agent-provider.js";
import screenModule from "../dist-electron/main/providers/cli-screen.js";
import conversationsModule from "../dist-electron/shared/agent-conversations.js";
import headless from "@xterm/headless";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { setTimeout } from "node:timers";
const { Terminal } = headless;

const { AgentSessionManager } = managerModule;
const { CodexAgentProvider } = codexModule;
const { ClaudeAgentProvider } = claudeModule;
const { pastePrompt, pasteChunks, isProtocolInput, PASTE_CHUNK_BYTES } = screenModule;
const { savedConversation, resumeRequest } = conversationsModule;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Writes as the CLI received them, with each paste's pieces joined back into one. */
const joined = (writes) => {
  const out = []; let paste;
  for (const data of writes) {
    if (data === "\x1b[200~") paste = data;
    else if (paste !== undefined) { paste += data; if (data === "\x1b[201~") { out.push(paste); paste = undefined; } }
    else out.push(data);
  }
  return paste === undefined ? out : [...out, paste];
};
const request = (prompt, intent = "default") => ({ prompt, intent });
const screen = (cursorLine, other = [], cursorX = 2) => ({ lines: [...other, cursorLine], cursorLine, cursorX, cursorY: other.length, cursorCellDim: true, inputWasEdited: false, bracketedPaste: true });

test("native launch and resume belong to each adapter", () => {
  const codex = new CodexAgentProvider(), claude = new ClaudeAgentProvider();
  const id = "2f1c7f54-8a51-4a5e-9d6c-3f1f0a7b1c11";
  assert.deepEqual(codex.args(), []);
  assert.deepEqual(codex.args({ kind: "pick" }), ["resume"]);
  assert.deepEqual(codex.args({ kind: "latest" }), ["resume", "--last"]);
  assert.deepEqual(codex.args({ kind: "id", id }), ["resume", id]);
  assert.deepEqual(claude.args(), []);
  assert.deepEqual(claude.args({ kind: "pick" }), ["--resume"]);
  assert.deepEqual(claude.args({ kind: "latest" }), ["--continue"]);
  assert.deepEqual(claude.args({ kind: "id", id }), ["--resume", id]);
});
test("a saved conversation is reopened by id, else the folder's newest, else the CLI's picker", () => {
  const legacy = { autoTitle: false, cwd: "/w", providerId: "codex.cli" };
  // Older state has no record, but a title taken from a prompt shows a conversation exists.
  assert.deepEqual(savedConversation(legacy), { providerId: "codex.cli" });
  assert.equal(savedConversation({ ...legacy, conversation: null }), undefined);
  assert.equal(savedConversation({ autoTitle: true, cwd: "/w", providerId: "codex.cli" }), undefined);
  assert.equal(savedConversation(undefined), undefined);
  assert.deepEqual(resumeRequest({ cwd: "/w", conversation: { providerId: "claude.cli", id: "x" } }, []), { kind: "id", id: "x" });
  assert.deepEqual(resumeRequest(legacy, [legacy]), { kind: "latest" });
  assert.deepEqual(resumeRequest(legacy, [legacy, { ...legacy, cwd: "/other" }, { cwd: "/w", providerId: "claude.cli", conversation: { providerId: "claude.cli" } }]), { kind: "latest" });
  // Another view's conversation in the same folder could be the newest one: let the person choose.
  assert.deepEqual(resumeRequest(legacy, [legacy, { cwd: "/w", conversation: { providerId: "codex.cli" } }]), { kind: "pick" });
  assert.equal(resumeRequest({ autoTitle: true }, []), undefined);
});
test("a CLI that accepts one gets a conversation id at launch, and resumes by it", async () => {
  const provider = () => Object.assign(new ClaudeAgentProvider(), { startupSettleMs: 0 });
  const fresh = setup(provider());
  const { conversationId } = await fresh.manager.attach(fresh.id, fresh.owner);
  assert.match(conversationId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(fresh.spawned[0].slice(0, 2), ["--session-id", conversationId]);
  fresh.manager.terminateAll();
  const resumed = setup(provider(), { resume: { kind: "id", id: conversationId }, viewId: "again" });
  assert.equal((await resumed.manager.attach(resumed.id, resumed.owner)).conversationId, conversationId);
  assert.deepEqual(resumed.spawned[0].slice(0, 2), ["--resume", conversationId]);
  assert.equal(resumed.spawned[0].includes("--session-id"), false);
  resumed.manager.terminateAll();
  // Codex takes no id: nothing is invented for it.
  const codex = setup();
  assert.equal((await codex.manager.attach(codex.id, codex.owner)).conversationId, undefined);
  assert.deepEqual(codex.spawned[0], []);
  codex.manager.terminateAll();
});
test("screen rules distinguish ready, native drafts, working, decisions and unknown", () => {
  const codex = new CodexAgentProvider(); const claude = new ClaudeAgentProvider();
  assert.equal(codex.detect(screen("› Ask Codex to do anything")).canSubmit, true);
  assert.equal(codex.detect(screen("› Implement my feature", [], 22)).canSubmit, false);
  assert.equal(codex.detect({ ...screen("› Ask Codex to do anything"), cursorCellDim: false }).canSubmit, false);
  assert.equal(claude.detect(screen("❯ ")).canSubmit, true);
  assert.equal(claude.detect(screen('❯ Try "fix lint errors"')).canSubmit, true);
  assert.equal(claude.detect({ ...screen('❯ Try "fix lint errors"'), inputWasEdited: true }).canSubmit, false);
  // Codex's placeholder is dim, so stray input (a mouse move) can never turn it into a draft.
  assert.equal(codex.detect({ ...screen("› Ask Codex to do anything"), inputWasEdited: true }).canSubmit, true);
  assert.equal(codex.detect({ ...screen("› ", []), reportedState: "working" }).activity, "working");
  assert.equal(codex.detect(screen("", ["  Update available · 0.166.0 → 0.167.0", "› 1. Update now", "  2. Skip", "  enter continue · esc skip"], 0)).activity, "waiting-for-input");
  assert.equal(claude.detect(screen("❯ draft", [], 7)).canSubmit, false);
  assert.equal(codex.detect(screen("› ", ["• Working (esc to interrupt)"])).activity, "working");
  assert.equal(claude.detect(screen("❯ ", ["✻ Thinking… (esc to interrupt)"])).canSubmit, true);
  assert.equal(claude.detect(screen("❯ 1. Yes, I trust this folder", ["Enter to confirm"])).activity, "waiting-for-input");
  assert.equal(codex.detect(screen("› ", ["You can sign in later. Select an option below."])).canSubmit, true);
  assert.equal(claude.detect(screen("❯ ", ["Do you want to proceed? Enter to confirm."])).activity, "ready");
  assert.equal(codex.detect(screen("Unexpected new UI")).activity, "unknown");
  assert.equal(codex.detect({ ...screen("› "), bracketedPaste: false }).canSubmit, false);
  assert.equal(codex.detect(screen("  second line", ["› first line"], 13)).inputState, "draft");
});
test("paste preserves Unicode and large multiline text but rejects control injection", () => {
  const text = "Hello 世界 🧭\n".repeat(5000);
  assert.equal(pastePrompt(text), `\x1b[200~${text}\x1b[201~`);
  assert.equal(pastePrompt("a\r\nb"), "\x1b[200~a\nb\x1b[201~");
  for (const value of ["\x1b[201~rm -rf x", "a\x03", "\r", " "]) assert.throws(() => pastePrompt(value));
  const chunks = pasteChunks(text);
  assert.equal(chunks[0], "\x1b[200~"); assert.equal(chunks.at(-1), "\x1b[201~");
  assert(chunks.slice(1, -1).every((chunk) => Buffer.byteLength(chunk) <= PASTE_CHUNK_BYTES));
  assert.equal(chunks.slice(1, -1).join(""), text);
});
test("mouse reports, focus and terminal replies are not typing", () => {
  for (const data of ["\x1b[<35;10;10M", "\x1b[<35;10;10M\x1b[<35;11;10M", "\x1b[<0;3;4m", "\x1b[I", "\x1b[O", "\x1b[12;40R", "\x1b[?1;2c", "\x1b]11;rgb:1a1a/1b1b/2020\x1b\\"]) {
    assert.equal(isProtocolInput(data), true, JSON.stringify(data));
  }
  for (const data of ["a", "hello", "\r", "\x1b", "\x7f", "\x1b[A"]) assert.equal(isProtocolInput(data), false, JSON.stringify(data));
});

test("each adapter owns its mode switch and model launch arguments", () => {
  const codex = new CodexAgentProvider(), claude = new ClaudeAgentProvider();
  const prompt = "Be concise.\n\nTerminal selection 1:\n> /exit\n\nPlan 世界 🧭";
  for (const provider of [codex, claude]) {
    assert.equal(provider.capabilities.planning, true);
    assert.deepEqual(provider.submit(request(prompt, "plan")).paste, pasteChunks(prompt));
    for (const text of ["/exit", "!rm anything", "text\x1b[201~\r", "text\x03"]) assert.throws(() => provider.submit(request(text, "plan")));
  }
  // Codex's /plan takes no prompt; Claude cycles with Shift+Tab.
  assert.deepEqual(codex.enterPlan, { command: "/plan" });
  assert.deepEqual(claude.enterPlan, { cycle: "\x1b[Z" });
  assert.deepEqual(codex.modelArgs({ model: "gpt-6-luna", effort: "high" }), ["--model", "gpt-6-luna", "-c", 'model_reasoning_effort="high"', "-c", 'plan_mode_reasoning_effort="high"']);
  assert.deepEqual(claude.modelArgs({ model: "opus", effort: "medium" }), ["--model", "opus", "--effort", "medium"]);
});
test("modes are read from the footer, not from hints or the transcript", () => {
  const codex = new CodexAgentProvider(), claude = new ClaudeAgentProvider();
  const at = (prompt, below, above = []) => ({ ...screen(prompt, above), lines: [...above, prompt, ...below] });
  assert.equal(codex.mode(at("› Ask", ["", "  GPT-6.1-Sol medium · ~/x         Plan mode (⇧tab to cycle)"])), "plan");
  assert.equal(codex.mode(at("› Ask", ["", "  GPT-6.1-Sol medium · ~/x"])), "default");
  assert.equal(codex.mode(at("› /plan", ["", "  GPT-6.1-Sol medium"], ["› /plan  switch to Plan mode"])), "default");
  assert.equal(codex.mode(at("› Ask", [""], ["I'll stay in Plan mode"])), "default");
  assert.equal(claude.mode(at("❯ ", ["───", "  ⏸ plan mode on (shift+tab to cycle)"])), "plan");
  assert.equal(claude.mode(at("❯ ", ["───", "  ⏵⏵ auto mode on (shift+tab to cycle)            ◐ medium · /effort"])), "auto mode on");
  assert.equal(claude.mode(at("❯ ", ["───", "  ⏸ manual mode on                                ◐ medium · /effort"])), "manual mode on");
  assert.equal(claude.mode(at("❯ ", ["───", "  ⏵⏵ bypass permissions on (shift+tab to cycle)"])), "bypass permissions on");
  assert.equal(claude.mode(at("❯ ", ["───", "  ? for shortcuts"])), "default");
});

function setup(provider = Object.assign(new CodexAgentProvider(), { startupSettleMs: 0 }), extra = {}) {
  const events = [], writes = [], processes = [];
  const owner = { isDestroyed: () => false, send: (_channel, event) => events.push(event) };
  // Discovery resolves a real executable; the test injects only the PTY boundary.
  provider.executable = process.execPath;
  const spawned = [];
  const manager = new AgentSessionManager([provider], (_command, args) => {
    spawned.push(args);
    const p = { onData: (cb) => { p.data = cb; }, onExit: (cb) => { p.exit = cb; }, write: (data) => {
      writes.push(data);
      if (data === "\x1b[201~") p.data("\r\x1b[2K› pasted draft");
      if (data === "\r") p.data("\r\x1b[2K› ");
    }, resize: () => {}, kill: () => { p.killed = true; } };
    processes.push(p); return p;
  });
  const options = { providerId: provider.id, workspacePath: "/tmp", viewId: "view", cols: 80, rows: 24, ...extra };
  const id = manager.create(options, owner);
  // The window's terminal gives its size as it attaches; until then a first prompt waits (ATTACH_GRACE_MS).
  manager.resize(id, 80, 24, owner);
  return { manager, options, id, owner, events, writes, processes, spawned, output: (data) => processes[0].data(data) };
}

test("create is idempotent, startup output is captured, ownership is enforced", async () => {
  const s = setup();
  try {
    assert.equal(s.manager.create(s.options, s.owner), s.id);
    assert.equal(s.processes.length, 1);
    s.output("\x1b[?2004h› \x1b[2mAsk Codex to do anything\r\x1b[2C");
    await sleep(350);
    const snapshot = await s.manager.attach(s.id, s.owner);
    assert.match(snapshot.screen, /Ask Codex/);
    assert.equal(snapshot.status.canSubmit, true);
    const other = { ...s.owner };
    await assert.rejects(s.manager.attach(s.id, other));
    await assert.rejects(s.manager.sendPrompt(s.id, request("hello"), other));
    assert.throws(() => s.manager.input(s.id, "bad", other));
    assert.throws(() => s.manager.resize(s.id, 10, 10, other));
    assert.throws(() => s.manager.terminate(s.id, other));
    assert.equal(s.processes[0].killed, undefined);
  } finally { s.manager.terminateAll(); }
});
test("delivery serializes paste and submit, rejects double send and terminal drafts", async () => {
  const s = setup();
  try {
    s.output("\x1b[?2004h› \r\x1b[2C"); await sleep(350);
    const pending = s.manager.sendPrompt(s.id, request("hello\nworld"), s.owner);
    assert.equal((await s.manager.sendPrompt(s.id, request("duplicate"), s.owner)).outcome, "not-sent");
    s.manager.input(s.id, "interleaved", s.owner);
    await pending;
    assert.deepEqual(joined(s.writes), ["\x1b[200~hello\nworld\x1b[201~", "\r"]);
    s.output("\r\x1b[2K› native draft");
    await s.manager.attach(s.id, s.owner);
    assert.match((await s.manager.sendPrompt(s.id, request("new"), s.owner)).message, /draft/);
  } finally { s.manager.terminateAll(); }
});
test("decisions never receive a submit; exit retains screen and blocks input", async () => {
  const s = setup();
  try {
    s.output("\x1b[?2004hDo you want to proceed?\r\n› Yes, proceed");
    assert.equal((await s.manager.sendPrompt(s.id, request("hello"), s.owner)).outcome, "not-sent");
    assert.deepEqual(s.writes, []);
    s.processes[0].exit({ exitCode: 1 });
    const snapshot = await s.manager.attach(s.id, s.owner);
    assert.equal(snapshot.status.lifecycle, "failed");
    assert.match(snapshot.screen, /proceed/);
    s.manager.input(s.id, "not a shell command", s.owner);
    assert.deepEqual(s.writes, []);
  } finally { s.manager.terminateAll(); }
});
test("completion differs from interruption; unknown screens never imply completion", async () => {
  const s = setup();
  const render = async (text) => { s.output(`\x1b[2J\x1b[H\x1b[?2004h${text}`); return (await s.manager.attach(s.id, s.owner)).status; };
  try {
    // Work before the CLI first settles is startup, not a turn.
    await render("• Working (esc to interrupt)\r\n› ");
    const settled = await render("› ");
    assert.equal(settled.completed, 0);
    assert.equal(settled.started, 0);
    await sleep(350);
    assert.equal((await render("• Working (esc to interrupt)\r\n› ")).activity, "working");
    assert.equal((await render("new unknown display")).completed, 0);
    assert.equal((await render("› ")).completed, 1);
    await render("• Working (esc to interrupt)\r\n› ");
    s.manager.interrupt(s.id, s.owner);
    const after = await render("› ");
    assert.equal(after.completed, 1);
    // An interrupted turn still counts as started, so the conversation is no longer unused.
    assert.equal(after.started, 2);
  } finally { s.manager.terminateAll(); }
});
test("chunked ANSI redraws and bounded screen snapshots replay independently of viewport", async () => {
  const s = setup();
  const restored = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
  try {
    s.output("old output\r\n\x1b["); s.output("2J\x1b[H\x1b[?2004h› ");
    const first = await s.manager.attach(s.id, s.owner);
    await new Promise((resolve) => restored.write(first.screen, resolve));
    assert.equal(restored.buffer.active.getLine(0).translateToString(true).trimEnd(), "›");
    s.output("native draft");
    const second = await s.manager.attach(s.id, s.owner);
    assert(second.sequence > first.sequence);
    assert.equal(second.status.canSubmit, false);
    assert(s.events.every((event, i) => i === 0 || event.sequence > s.events[i - 1].sequence));
    s.manager.terminateForOwner(s.owner);
    assert.equal(s.processes[0].killed, true);
  } finally { restored.dispose(); s.manager.terminateAll(); }
});

test("approval appearing during paste prevents Enter and preserves the native decision", async () => {
  const s = setup();
  try {
    s.output("\x1b[?2004h› "); await sleep(350);
    s.processes[0].write = (data) => { s.writes.push(data); s.output("\x1b[2J\x1b[HDo you want to proceed?\r\n› Yes, proceed"); };
    const result = await s.manager.sendPrompt(s.id, request("hello"), s.owner);
    assert.equal(result.outcome, "uncertain");
    assert.equal(result.stage, "paste");
    assert.match(result.message, /may be pasted/);
    assert.deepEqual(joined(s.writes), [pastePrompt("hello")]);
  } finally { s.manager.terminateAll(); }
});

test("missing executable and spawn failure are actionable and do not create sessions", () => {
  const provider = new ClaudeAgentProvider(); provider.executable = "/missing/workbench-test-cli";
  const manager = new AgentSessionManager([provider]);
  assert.equal(manager.discover()[0].available, false);
  const options = { providerId: provider.id, workspacePath: "/tmp", viewId: "missing", cols: 80, rows: 24 };
  assert.throws(() => manager.create(options, {}), /not found/);
  provider.executable = process.execPath;
  const broken = new AgentSessionManager([provider], () => { throw new Error("spawn failed"); });
  assert.throws(() => broken.create(options, {}), /spawn failed/);
  manager.terminateAll(); broken.terminateAll();
});

test("Claude placeholders survive focus reports, while user-authored text remains a draft", async () => {
  const s = setup(new ClaudeAgentProvider());
  try {
    s.output('\x1b[?2004h❯ Try "fix lint errors"\r\x1b[2C');
    await sleep(350);
    assert.equal((await s.manager.attach(s.id, s.owner)).status.canSubmit, true);
    s.manager.input(s.id, "\x1b[<35;10;10M", s.owner);
    s.manager.input(s.id, "\x1b[I", s.owner);
    s.manager.input(s.id, "\x1b", s.owner);
    s.output("\r\x1b[2C");
    assert.equal((await s.manager.attach(s.id, s.owner)).status.canSubmit, true);
    s.manager.input(s.id, "Try", s.owner);
    s.output("\r\x1b[2C");
    assert.equal((await s.manager.attach(s.id, s.owner)).status.canSubmit, false);
  } finally { s.manager.terminateAll(); }
});

test("unrecognized editor and invalid content report not sent without any writes", async () => {
  const s = setup();
  try {
    s.output("Changed native UI");
    assert.equal((await s.manager.sendPrompt(s.id, request("task", "plan"), s.owner)).outcome, "not-sent");
    assert.equal((await s.manager.sendPrompt(s.id, request("bad\x1b", "plan"), s.owner)).stage, "none");
    assert.deepEqual(s.writes, []);
  } finally { s.manager.terminateAll(); }
});

test("a startup input that is replaced by a trust dialog never receives a prompt", async () => {
  const s = setup(Object.assign(new CodexAgentProvider(), { startupSettleMs: 150 }));
  try {
    s.output("\x1b[?2004h› \x1b[2mAsk Codex to do anything\r\x1b[2C");
    const starting = (await s.manager.attach(s.id, s.owner)).status;
    assert.equal(starting.canSubmit, false);
    assert.equal(starting.lifecycle, "starting");
    assert.equal((await s.manager.sendPrompt(s.id, request("hello"), s.owner)).outcome, "not-sent");
    s.output("\x1b[2J\x1b[HTrust this folder?\r\n› 1. Trust and continue");
    await sleep(350);
    assert.equal((await s.manager.attach(s.id, s.owner)).status.activity, "waiting-for-input");
    s.output("\x1b[2J\x1b[H\x1b[?2004h› \x1b[2mAsk Codex to do anything\r\x1b[2C");
    await sleep(350);
    const ready = (await s.manager.attach(s.id, s.owner)).status;
    assert.equal(ready.canSubmit, true);
    assert.equal(ready.lifecycle, "alive");
    assert.equal(s.events.at(-1).status.canSubmit, true);
    assert.deepEqual(s.writes, []);
  } finally { s.manager.terminateAll(); }
});

test("a draft held while Codex finishes startup is confirmed once it submits", async () => {
  const s = setup();
  try {
    s.output("\x1b[?2004h› "); await sleep(350);
    s.processes[0].write = (data) => {
      s.writes.push(data);
      if (data === "\x1b[201~") s.output("\r\x1b[2K› hello");
      if (data === "\r") {
        s.output("\r\n  Waiting for startup  · esc cancel\x1b[1A\r\x1b[7C");
        setTimeout(() => s.output("\x1b[2J\x1b[H\x1b[?2004h› "), 2500);
      }
    };
    const result = await s.manager.sendPrompt(s.id, request("hello"), s.owner);
    assert.equal(result.outcome, "submitted");
    assert.deepEqual(joined(s.writes), ["\x1b[200~hello\x1b[201~", "\r"]);
  } finally { s.manager.terminateAll(); }
});

test("Claude's queue placeholder is an empty input, and the held prompt reads as queued", () => {
  const claude = new ClaudeAgentProvider(); const codex = new CodexAgentProvider();
  const queued = claude.detect(screen("❯ Press up to edit queued messages", ["❯ follow up", "  ctrl+enter to send now", "", "✢ Polishing… (49s)"]));
  assert.equal(queued.inputState, "empty");
  assert.equal(queued.canSubmit, true);
  assert.equal(queued.queuedPrompt, true);
  assert.match(queued.reason, /Press Up/);
  // Typed by the person, the same words are a draft.
  assert.equal(claude.detect({ ...screen("❯ Press up to edit queued messages"), inputWasEdited: true }).inputState, "draft");
  // A draft typed under a queued prompt: still queued, and the draft blocks a send.
  const typing = claude.detect(screen("❯ more", ["❯ follow up", "  ctrl+enter to send now", "", "✢ Polishing… (49s)"], 6));
  assert.equal(typing.inputState, "draft");
  assert.equal(typing.queuedPrompt, true);
  assert.equal(claude.detect(screen("❯ ")).queuedPrompt, undefined);
  assert.equal(codex.detect(screen("› Press up to edit queued messages")).inputState, "draft");
});

test("a Claude prompt sent mid-turn is submitted as soon as the CLI queues it", async () => {
  const s = setup(new ClaudeAgentProvider());
  const turn = "\x1b[2J\x1b[H\x1b[?2004h✢ Polishing… (49s · thinking)\r\n\r\n";
  try {
    // Settled first: work before that is startup, which holds a first prompt.
    s.output("\x1b[?2004h❯ \r\x1b[2C"); await sleep(350);
    s.output(`${turn}❯ \r\x1b[2C`);
    s.processes[0].write = (data) => {
      s.writes.push(data);
      if (data === "\x1b[201~") s.output(`${turn}❯ follow up`);
      if (data === "\r") s.output(`\x1b[2J\x1b[H\x1b[?2004h❯ follow up\r\n  ctrl+enter to send now\r\n\r\n✢ Polishing… (50s · thinking)\r\n\r\n❯ Press up to edit queued messages\r\x1b[2C`);
    };
    const started = Date.now();
    const result = await s.manager.sendPrompt(s.id, request("follow up"), s.owner);
    assert.equal(result.outcome, "submitted", result.message);
    assert.match(result.message, /queued/);
    assert(Date.now() - started < 2000, "confirmed without waiting out the turn");
    const { status } = await s.manager.attach(s.id, s.owner);
    assert.equal(status.queuedPrompt, true);
    // The CLI takes it: no longer queued.
    s.output(`\x1b[2J\x1b[H\x1b[?2004h❯ follow up\r\n\r\n✢ Polishing… (51s · thinking)\r\n\r\n❯ \r\x1b[2C`);
    assert.equal((await s.manager.attach(s.id, s.owner)).status.queuedPrompt, undefined);
  } finally { s.manager.terminateAll(); }
});

test("an Enter that could not be confirmed is confirmed later when the input empties, unless the person typed", async () => {
  for (const typed of [false, true]) {
    const s = setup(new ClaudeAgentProvider());
    try {
      s.output("\x1b[?2004h❯ \r\x1b[2C"); await sleep(350);
      s.processes[0].write = (data) => {
        s.writes.push(data);
        if (data === "\x1b[201~") s.output("\r\x1b[2K❯ task");
        // A screen the rules don't know: the input still shows text.
        if (data === "\r") s.output("\r\x1b[2K❯ Some new hint the CLI draws");
      };
      const result = await s.manager.sendPrompt(s.id, request("task"), s.owner);
      assert.equal(result.outcome, "uncertain");
      assert.equal(result.stage, "enter");
      s.processes[0].write = (data) => s.writes.push(data);
      if (typed) s.manager.input(s.id, "\x15", s.owner);
      s.output("\r\x1b[2K❯ \r\x1b[2C");
      const { status } = await s.manager.attach(s.id, s.owner);
      assert.equal(status.confirmedDeliveries, typed ? 0 : 1);
    } finally { s.manager.terminateAll(); }
  }
});



/** A small stand-in CLI that draws its prompt with a real footer and changes mode the way each CLI does. */
function fakeCli(s, kind, { modes = kind === "codex" ? ["default", "plan"] : ["auto mode on", "manual mode on", "accept edits on", "plan mode on"], start = 0, ignorePlan = false } = {}) {
  let mode = start, draft = "", paste;
  const marker = kind === "codex" ? "›" : "❯";
  const footerLine = () => kind === "codex"
    ? `  GPT-6.1-Sol medium · ~/repos/x${modes[mode] === "plan" ? "         Plan mode (⇧tab to cycle)" : ""}`
    : `  ${modes[mode] === "plan mode on" ? "⏸ plan mode on (shift+tab to cycle)" : modes[mode] === "manual mode on" ? "⏸ manual mode on" : `⏵⏵ ${modes[mode]} (shift+tab to cycle)`}`;
  const draw = () => s.output(`\x1b[2J\x1b[H\x1b[?2004h${marker} ${draft}\r\n\r\n${footerLine()}\x1b[1;${draft.length + 3}H`);
  s.processes[0].write = (data) => {
    s.writes.push(data);
    if (data === "\x1b[200~") { paste = ""; return; }
    if (paste !== undefined) { if (data === "\x1b[201~") { draft = kind === "codex" ? "[Pasted]" : paste.split("\n")[0]; paste = undefined; draw(); } else paste += data; return; }
    if (data === "\r") { if (draft === "/plan" && !ignorePlan) mode = modes.indexOf("plan"); draft = ""; draw(); return; }
    if (data === "\x1b[Z") { mode = (mode + 1) % modes.length; draw(); return; }
    draft += data; draw();
  };
  draw();
  return { mode: () => modes[mode] };
}

test("Codex: Plan types /plan, confirms it, waits for the footer; Code leaves Plan with Shift+Tab", async () => {
  const s = setup();
  try {
    const cli = fakeCli(s, "codex"); await sleep(350);
    let result = await s.manager.sendPrompt(s.id, request("persona\n\ntask", "plan"), s.owner);
    assert.equal(result.outcome, "submitted", result.message);
    assert.deepEqual(joined(s.writes), ["/plan", "\r", pastePrompt("persona\n\ntask"), "\r"]);
    assert.equal(cli.mode(), "plan");
    // Already in Plan: no second /plan.
    s.writes.length = 0;
    assert.equal((await s.manager.sendPrompt(s.id, request("follow up", "plan"), s.owner)).outcome, "submitted");
    assert.deepEqual(joined(s.writes), [pastePrompt("follow up"), "\r"]);
    s.writes.length = 0;
    result = await s.manager.sendPrompt(s.id, request("now build it"), s.owner);
    assert.equal(result.outcome, "submitted", result.message);
    assert.deepEqual(joined(s.writes), ["\x1b[Z", pastePrompt("now build it"), "\r"]);
    assert.equal(cli.mode(), "default");
  } finally { s.manager.terminateAll(); }
});

test("Claude: Plan cycles Shift+Tab to plan mode, Code cycles back to the mode the session started in", async () => {
  for (const start of [0, 1]) {
    const s = setup(new ClaudeAgentProvider());
    try {
      const cli = fakeCli(s, "claude", { start }); await sleep(350);
      const home = cli.mode();
      let result = await s.manager.sendPrompt(s.id, request("plan this", "plan"), s.owner);
      assert.equal(result.outcome, "submitted", result.message);
      assert.equal(cli.mode(), "plan mode on");
      assert.deepEqual(joined(s.writes), [...Array(3 - start).fill("\x1b[Z"), pastePrompt("plan this"), "\r"]);
      result = await s.manager.sendPrompt(s.id, request("build it"), s.owner);
      assert.equal(result.outcome, "submitted", result.message);
      assert.equal(cli.mode(), home);
    } finally { s.manager.terminateAll(); }
  }
});

test("a Plan switch that never shows in the footer stops before the prompt is pasted", async () => {
  const s = setup();
  try {
    fakeCli(s, "codex", { ignorePlan: true }); await sleep(350);
    const result = await s.manager.sendPrompt(s.id, request("task", "plan"), s.owner);
    assert.equal(result.outcome, "not-sent");
    assert.equal(result.stage, "mode");
    assert.match(result.message, /Plan mode could not be confirmed/);
    assert.deepEqual(s.writes, ["/plan", "\r"]);
  } finally { s.manager.terminateAll(); }
});

test("a decision while typing /plan stops before Enter and before the paste", async () => {
  const s = setup();
  try {
    s.output("\x1b[?2004h› "); await sleep(350);
    s.processes[0].write = (data) => { s.writes.push(data); s.output("\x1b[2J\x1b[HDo you want to proceed?\r\n› Yes, proceed"); };
    const result = await s.manager.sendPrompt(s.id, request("task", "plan"), s.owner);
    assert.equal(result.outcome, "not-sent");
    assert.equal(result.stage, "mode");
    assert.deepEqual(s.writes, ["/plan"]);
  } finally { s.manager.terminateAll(); }
});

test("a decision after Enter reports uncertainty and never retries", async () => {
  const s = setup();
  try {
    s.output("\x1b[?2004h› "); await sleep(350);
    s.processes[0].write = (data) => {
      s.writes.push(data);
      if (data === "\x1b[201~") s.output("\r\x1b[2K› draft");
      if (data === "\r") s.output("\x1b[2J\x1b[HDo you want to proceed?\r\n› Yes, proceed");
    };
    const result = await s.manager.sendPrompt(s.id, request("task"), s.owner);
    assert.equal(result.outcome, "uncertain");
    assert.equal(result.stage, "enter");
    assert.deepEqual(joined(s.writes), [pastePrompt("task"), "\r"]);
  } finally { s.manager.terminateAll(); }
});

test("mouse moves over the terminal never block a send (Codex tracks every pointer move)", async () => {
  const s = setup();
  try {
    s.output("\x1b[?2004h\x1b[?1003h\x1b[?1006h› \x1b[2mAsk Codex to do anything\x1b[22m\r\x1b[2C"); await sleep(350);
    for (let x = 1; x < 20; x++) s.manager.input(s.id, `\x1b[<35;${x};10M`, s.owner);
    s.manager.input(s.id, "\x1b[I", s.owner);
    s.output("\r\x1b[2C");
    assert.equal((await s.manager.attach(s.id, s.owner)).status.canSubmit, true);
    assert.equal((await s.manager.sendPrompt(s.id, request("hello"), s.owner)).outcome, "submitted");
  } finally { s.manager.terminateAll(); }
});

test("a first prompt waits for the window's terminal size, quiet output and an idle CLI", async () => {
  const provider = Object.assign(new CodexAgentProvider(), { startupSettleMs: 0 });
  provider.executable = process.execPath;
  const owner = { isDestroyed: () => false, send: () => {} };
  let p;
  const manager = new AgentSessionManager([provider], () => (p = { onData: (cb) => { p.data = cb; }, onExit: () => {}, write: () => {}, resize: () => {}, kill: () => {} }));
  try {
    const id = manager.create({ providerId: provider.id, workspacePath: "/tmp", viewId: "v", cols: 80, rows: 24 }, owner);
    p.data("\x1b[?2004h\x1b]7501;state=working:app=codex\x1b\\› \x1b[2mAsk Codex to do anything\r\x1b[2C");
    await sleep(350);
    assert.equal((await manager.attach(id, owner)).status.lifecycle, "starting", "Codex still says it is working");
    // A finished turn says "done", which is not busy either.
    p.data("\x1b]7501;state=done:app=codex\x1b\\");
    await sleep(350);
    assert.equal((await manager.attach(id, owner)).status.lifecycle, "starting", "no window size yet");
    manager.resize(id, 100, 30, owner);
    p.data("\r\x1b[2C");
    await sleep(350);
    const status = (await manager.attach(id, owner)).status;
    assert.equal(status.lifecycle, "alive");
    assert.equal(status.canSubmit, true);
  } finally { manager.terminateAll(); }
});

test("model and effort are launch arguments of a new conversation, never of a resumed one", () => {
  const settings = { model: "gpt-6-luna", effort: "high" };
  const codex = setup(undefined, { settings });
  assert.deepEqual(codex.spawned[0], ["--model", "gpt-6-luna", "-c", 'model_reasoning_effort="high"', "-c", 'plan_mode_reasoning_effort="high"']);
  codex.manager.terminateAll();
  const resumed = setup(undefined, { settings, resume: { kind: "pick" }, viewId: "resumed" });
  assert.deepEqual(resumed.spawned[0], ["resume"]);
  resumed.manager.terminateAll();
  const claude = new ClaudeAgentProvider();
  claude.executable = process.execPath;
  const root = process.cwd();
  const spawned = [];
  const manager = new AgentSessionManager([claude], (_c, args) => { spawned.push(args); return { onData: () => {}, onExit: () => {}, write: () => {}, resize: () => {}, kill: () => {} }; });
  manager.create({ providerId: claude.id, workspacePath: root, viewId: "c", cols: 80, rows: 24, settings: { model: "opus", effort: "medium" } }, {});
  assert.deepEqual(spawned[0].slice(2), ["--model", "opus", "--effort", "medium"]);
  // Only a model and effort the adapter offers become arguments.
  assert.throws(() => manager.create({ providerId: claude.id, workspacePath: root, viewId: "bad", cols: 80, rows: 24, settings: { model: "opus\r", effort: "medium" } }, {}), /Unsupported model/);
  assert.throws(() => manager.create({ providerId: claude.id, workspacePath: root, viewId: "bad2", cols: 80, rows: 24, settings: { model: "opus", effort: "ultra" } }, {}), /Unsupported model/);
  assert.equal(spawned.length, 1);
  // A CLI that asks before reading outside its folder is granted the view's attachments at launch.
  const granted = [];
  const folders = new AgentSessionManager([claude], (_c, args) => { granted.push(args); return { onData: () => {}, onExit: () => {}, write: () => {}, resize: () => {}, kill: () => {} }; }, (viewId) => `/attachments/${viewId}`);
  folders.create({ providerId: claude.id, workspacePath: root, viewId: "c2", cols: 80, rows: 24 }, {});
  assert.deepEqual(granted[0].slice(2), ["--add-dir", "/attachments/c2"]);
  folders.terminateAll();
  // The catalogue reaches the renderer through discovery.
  assert.deepEqual(manager.discover()[0].models.map((model) => model.id), ["opus", "fable", "sonnet", "haiku"]);
  manager.terminateAll();
});

/** Replays a recorded transcript (scripts/cli-probe.mjs) into a session, stopping at each mark. */
async function replay(file, Provider, check) {
  const fixture = JSON.parse(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), "utf8"));
  const provider = Object.assign(new Provider(), { startupSettleMs: 0 });
  provider.executable = process.execPath;
  const owner = { isDestroyed: () => false, send: () => {} };
  let p;
  const manager = new AgentSessionManager([provider], () => (p = { onData: (cb) => { p.data = cb; }, onExit: () => {}, write: () => {}, resize: () => {}, kill: () => {} }));
  try {
    const id = manager.create({ providerId: provider.id, workspacePath: "/tmp", viewId: "v", cols: fixture.cols, rows: fixture.rows }, owner);
    manager.resize(id, fixture.cols, fixture.rows, owner);
    const session = manager.sessions.get(id);
    for (const chunk of fixture.chunks) {
      if (!chunk.mark) { p.data(chunk.data); continue; }
      await sleep(350);
      const { status } = await manager.attach(id, owner);
      await check(chunk.mark, status, provider.mode(manager.observe(session)), { manager, id, owner });
    }
  } finally { manager.terminateAll(); }
}

test("recorded Codex 0.166: update picker, ready despite mouse moves, /plan, Plan footer, back to Code", async () => {
  const seen = [];
  await replay("codex.json", CodexAgentProvider, async (mark, status, mode, { manager, id, owner }) => {
    seen.push(mark);
    if (mark === "update") assert.equal(status.activity, "waiting-for-input");
    if (mark === "ready") { assert.equal(status.canSubmit, true, status.reason); assert.equal(mode, "default"); manager.input(id, "\x1b[<35;10;10M", owner); }
    if (mark === "mouse") assert.equal(status.canSubmit, true, status.reason);
    if (mark === "plan-picker") { assert.equal(status.inputState, "draft"); assert.equal(mode, "default"); }
    if (mark === "plan") { assert.equal(status.canSubmit, true, status.reason); assert.equal(mode, "plan"); }
    if (mark === "code") { assert.equal(status.canSubmit, true, status.reason); assert.equal(mode, "default"); }
  });
  assert.deepEqual(seen, ["update", "ready", "mouse", "plan-picker", "plan", "code"]);
});

test("recorded Claude Code 2.1: ready with its placeholder, Shift+Tab cycles through to plan mode", async () => {
  const modes = {};
  await replay("claude.json", ClaudeAgentProvider, async (mark, status, mode) => {
    modes[mark] = mode;
    assert.equal(status.canSubmit, true, `${mark}: ${status.reason}`);
  });
  assert.deepEqual(modes, { ready: "auto mode on", mouse: "auto mode on", cycle1: "manual mode on", cycle2: "accept edits on", plan: "plan", cycle4: "auto mode on" });
});

test("recorded Claude Code 2.1.321: a prompt sent mid-turn is queued, then taken", async () => {
  const seen = {};
  await replay("claude-queued.json", ClaudeAgentProvider, async (mark, status) => {
    seen[mark] = `${status.activity}/${status.inputState}${status.queuedPrompt ? "/queued" : ""}`;
  });
  assert.deepEqual(seen, { ready: "ready/empty", working: "working/empty", "second-pasted": "working/draft", queued: "working/empty/queued", end: "ready/empty" });
});

test("recorded Codex 0.167: Enter mid-turn steers the running turn, so nothing is queued", async () => {
  const seen = {};
  await replay("codex-queued.json", CodexAgentProvider, async (mark, status) => {
    seen[mark] = `${status.inputState}${status.queuedPrompt ? "/queued" : ""}`;
  });
  assert.deepEqual(seen, { ready: "empty", working: "empty", "second-pasted": "draft", queued: "empty", end: "empty" });
});

test("a planning follow-up while the CLI is still working in Plan mode is refused before any paste", async () => {
  const s = setup();
  try {
    s.output("\x1b[2J\x1b[H\x1b[?2004h• Working (esc to interrupt)\r\n› \r\n\r\n  GPT-6.1-Sol medium         Plan mode (⇧tab to cycle)\x1b[2;3H");
    await sleep(350);
    const result = await s.manager.sendPrompt(s.id, request("follow up", "plan"), s.owner);
    assert.equal(result.outcome, "not-sent");
    assert.equal(result.stage, "none");
    assert.deepEqual(s.writes, []);
  } finally { s.manager.terminateAll(); }
});
