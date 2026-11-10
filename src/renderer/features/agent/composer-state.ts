import { create } from "zustand";
import type { AgentDeliveryResult, AgentModelSettings, AgentPromptRequest, AgentViewState, PromptAttachment } from "../../../shared/models";
import { resumeRequest, savedConversation } from "../../../shared/agent-conversations";
import { attachmentsPrompt, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS } from "../../../shared/prompt-attachments";
import { resetSelections, resolveOptions, type PromptSelections } from "../../../shared/prompt-options";
import type { AssembledPrompt } from "../../core/prompt-assembler";
import { createId } from "../../core/id";
import { errorMessage } from "../../core/errors";
import { services } from "../../core/services";
import { closeAgentRuntime, isUnusedConversation, markAgentPrompted, startAgentRuntime, untilSubmittable, useAgentRuntimes, type AgentRuntime } from "../../core/agent-runtimes";
import { useWorkbenchStore } from "../../state/workbench-store";
import { modelSettings, needsModelChoice, rememberAgentModels } from "./agent-models";

export interface ComposerTarget { workspaceId: string; viewId: string; }
export interface PromptPreview extends AssembledPrompt { intent: AgentPromptRequest["intent"]; }
export interface PromptHistoryEntry {
  id: string;
  createdAt: number;
  draft: string;
  attachments: PromptAttachment[];
  preview: PromptPreview;
  outcome: AgentDeliveryResult["outcome"] | "saved";
  message: string;
}
interface ComposerRuntime {
  history: PromptHistoryEntry[];
  sending: boolean;
  launching: boolean;
  /** Files still being stored; the prompt can't go until they are. */
  attaching: number;
  result?: AgentDeliveryResult;
  /** An uncertain delivery whose Enter went: main may still see the CLI take it (`confirmedDeliveries` rises). */
  unconfirmed?: { entryId: string; revision: number; controller: AgentRuntime["controller"]; confirmedBefore: number };
  resumeError?: string;
}
const emptyRuntime: ComposerRuntime = { history: [], sending: false, launching: false, attaching: 0 };
export const useComposerState = create<{ views: Record<string, ComposerRuntime> }>(() => ({ views: {} }));
export const emptyComposerRuntime = emptyRuntime;

function stateFor({ workspaceId, viewId }: ComposerTarget): AgentViewState | undefined {
  return useWorkbenchStore.getState().workspaces.find((w) => w.id === workspaceId)?.views.find((v) => v.id === viewId)?.state as AgentViewState | undefined;
}
function patchView(target: ComposerTarget, patch: Partial<AgentViewState>): void {
  useWorkbenchStore.getState().updateViewState(target.workspaceId, target.viewId, patch);
}
export function patchComposer(target: ComposerTarget, patch: Pick<AgentViewState, "draft" | "attachments" | "intent" | "modelSettings">): void {
  patchView(target, { ...patch, composerRevision: (stateFor(target)?.composerRevision ?? 0) + 1 });
}
export function setPromptSelections(target: ComposerTarget, promptSelections: PromptSelections): void {
  patchView(target, { promptSelections });
}
function exists({ workspaceId, viewId }: ComposerTarget): boolean {
  return Boolean(useWorkbenchStore.getState().workspaces.find((w) => w.id === workspaceId)?.views.some((v) => v.id === viewId));
}
function updateRuntime(viewId: string, patch: Partial<ComposerRuntime>): void {
  useComposerState.setState((state) => ({ views: { ...state.views, [viewId]: { ...(state.views[viewId] ?? emptyRuntime), ...patch } } }));
}
/** A new choice (model, effort) makes the last delivery's message stale. */
export function clearComposerResult(viewId: string): void {
  if (useComposerState.getState().views[viewId]?.result) updateRuntime(viewId, { result: undefined });
}
export function clearComposerRuntime(viewId: string): void {
  useComposerState.setState((state) => { const views = { ...state.views }; delete views[viewId]; return { views }; });
}
export function composedPrompt(target: ComposerTarget): PromptPreview {
  const state = stateFor(target);
  return { ...services.promptAssembler.assemble(state?.draft ?? "", services.promptContributors.collect(target)), intent: state?.intent ?? "default" };
}
function entryFor(target: ComposerTarget, outcome: PromptHistoryEntry["outcome"], message: string): PromptHistoryEntry {
  const state = stateFor(target);
  return { id: createId("prompt"), createdAt: Date.now(), draft: state?.draft ?? "", attachments: [...(state?.attachments ?? [])], preview: composedPrompt(target), outcome, message };
}
function remember(viewId: string, entry: PromptHistoryEntry): boolean {
  if (JSON.stringify(entry).length > 2_000_000) return false;
  const history = [entry, ...(useComposerState.getState().views[viewId]?.history ?? [])].slice(0, 20);
  // Keep local recall bounded even when prompts contain large pasted logs.
  while (history.length > 1 && JSON.stringify(history).length > 2_000_000) history.pop();
  updateRuntime(viewId, { history });
  return true;
}
function notSent(viewId: string, message: string): void {
  updateRuntime(viewId, { result: { outcome: "not-sent", stage: "none", message } });
}

/** Persona-style menus clear after a send; options may keep or clear themselves regardless of their menu. */
function resetMenusAfterSend(target: ComposerTarget): void {
  let selections = stateFor(target)?.promptSelections ?? {};
  for (const { menu, options } of services.promptMenus.resolve(target)) selections = resetSelections(options, selections, menu.resetAfterSend);
  setPromptSelections(target, selections);
}

/** Stores what fits and adds it to the prompt, in order; reports the rest in one error. */
async function attachFiles(target: ComposerTarget, files: File[]): Promise<void> {
  const attaching = () => useComposerState.getState().views[target.viewId]?.attaching ?? 0;
  const room = Math.max(0, MAX_ATTACHMENTS - (stateFor(target)?.attachments?.length ?? 0) - attaching());
  const fitting = files.filter((file) => file.size <= MAX_ATTACHMENT_BYTES);
  const accepted = fitting.slice(0, room);
  const problems: string[] = [];
  if (fitting.length < files.length) problems.push(`Files over ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB can’t be attached.`);
  if (accepted.length < fitting.length) problems.push(`A prompt can hold ${MAX_ATTACHMENTS} attachments.`);
  updateRuntime(target.viewId, { attaching: attaching() + accepted.length });
  const saved = await Promise.allSettled(accepted.map(async (file) =>
    window.workbench.attachments.save(target.viewId, file.name, new Uint8Array(await file.arrayBuffer()))));
  updateRuntime(target.viewId, { attaching: attaching() - accepted.length });
  const added = saved.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  if (added.length && exists(target)) patchComposer(target, { attachments: [...(stateFor(target)?.attachments ?? []), ...added] });
  saved.forEach((result, index) => { if (result.status === "rejected") problems.push(`Could not attach ${accepted[index].name}.`); });
  if (problems.length) throw new Error(problems.join(" "));
}

/**
 * The folder the CLI runs in, creating the session's worktree the first time it is needed.
 * Resuming never creates one: a CLI finds earlier conversations by folder, and a new worktree has none.
 */
export async function prepareSessionFolder(target: ComposerTarget, resume = false): Promise<string> {
  const workspace = useWorkbenchStore.getState().workspaces.find((w) => w.id === target.workspaceId);
  const state = stateFor(target);
  if (!workspace) throw new Error("The workspace was removed.");
  if (state?.cwd) return state.cwd;
  const worktree = !resume && state?.runIn?.kind === "worktree" ? state.runIn : undefined;
  if (!worktree) {
    patchView(target, { cwd: workspace.path, runIn: { kind: "checkout" } });
    return workspace.path;
  }
  const { sourceControl } = window.workbench;
  const base = worktree.base?.ref ?? (await sourceControl.baseBranches(workspace.path)).defaultRef;
  const { path: cwd } = await sourceControl.createWorktree(workspace.path, worktree.branch, base);
  patchView(target, { cwd });
  return cwd;
}

const sameSettings = (a: AgentModelSettings | null, b: AgentModelSettings | null) => a?.model === b?.model && a?.effort === b?.effort;
/**
 * The composer's model and effort when they differ from what the running conversation was launched with.
 * Undefined when nothing is pending, or for a resumed conversation, whose settings are its own.
 */
export function pendingSettings(runtime: AgentRuntime | undefined, state: AgentViewState | undefined): AgentModelSettings | undefined {
  if (!runtime || runtime.settings === undefined) return undefined;
  const wanted = modelSettings(runtime.providerId, state?.modelSettings?.[runtime.providerId]);
  return wanted && !sameSettings(wanted, runtime.settings) ? wanted : undefined;
}
function launchSettings(providerId: string, target: ComposerTarget): AgentModelSettings | undefined {
  return modelSettings(providerId, stateFor(target)?.modelSettings?.[providerId]) ?? undefined;
}

/** The provider and launch request that reopen this view's saved conversation, if it has one. */
function reopening(target: ComposerTarget) {
  const state = stateFor(target);
  const siblings = useWorkbenchStore.getState().workspaces.flatMap((w) => w.views.filter((v) => v.type === "agent").map((v) => (v.state ?? {}) as AgentViewState));
  const provider = services.sessions.get(savedConversation(state)?.providerId ?? "");
  const resume = resumeRequest(state, siblings);
  return resume && provider?.kind === "agent" ? { provider, resume } : undefined;
}

/**
 * Remembers a running conversation once something has happened in it, from the composer or typed in the terminal.
 * Until then a CLI has saved nothing, so there would be nothing to resume.
 */
function rememberConversations(): void {
  useAgentRuntimes.subscribe((state, previous) => {
    if (state.sessions === previous.sessions) return;
    for (const [viewId, runtime] of Object.entries(state.sessions)) {
      if (!runtime.prompted && !runtime.status?.started) continue;
      const workspace = useWorkbenchStore.getState().workspaces.find((w) => w.views.some((v) => v.id === viewId));
      if (!workspace) continue;
      const target = { workspaceId: workspace.id, viewId };
      const id = runtime.controller.conversationId;
      const saved = stateFor(target)?.conversation;
      if (saved?.providerId !== runtime.providerId || saved.id !== id) patchView(target, { conversation: { providerId: runtime.providerId, id } });
    }
  });
}

function titleFromPrompt(draft: string): string {
  const line = draft.trim().split("\n")[0].trim();
  return line.length > 40 ? `${line.slice(0, 39).trimEnd()}…` : line;
}

/** After the CLI takes a prompt: menus reset, the view is titled, and the composer clears unless edited meanwhile. */
function finishSubmitted(target: ComposerTarget, draft: string, revision: number): void {
  resetMenusAfterSend(target);
  if (stateFor(target)?.autoTitle && draft.trim()) {
    useWorkbenchStore.getState().renameView(target.workspaceId, target.viewId, titleFromPrompt(draft));
    patchView(target, { autoTitle: false });
  }
  if ((stateFor(target)?.composerRevision ?? 0) === revision) {
    patchComposer(target, { draft: "", attachments: [], intent: "default" });
  }
}

/** An uncertain delivery the CLI took after all (seen by main, never guessed here) becomes a submitted one. */
function confirmLate(target: ComposerTarget): void {
  const composer = useComposerState.getState().views[target.viewId];
  const pending = composer?.unconfirmed;
  const runtime = useAgentRuntimes.getState().sessions[target.viewId];
  if (!pending || runtime?.controller !== pending.controller || (runtime.status?.confirmedDeliveries ?? 0) <= pending.confirmedBefore) return;
  const message = "The CLI took the prompt after all.";
  const history = composer.history.map((item) => item.id === pending.entryId ? { ...item, outcome: "submitted" as const, message } : item);
  const entry = history.find((item) => item.id === pending.entryId);
  updateRuntime(target.viewId, { unconfirmed: undefined, history, result: { outcome: "submitted", stage: "enter", message } });
  if (exists(target)) finishSubmitted(target, entry?.draft ?? "", pending.revision);
}
function confirmLateDeliveries(): void {
  useAgentRuntimes.subscribe((state, previous) => {
    if (state.sessions === previous.sessions) return;
    for (const [viewId, composer] of Object.entries(useComposerState.getState().views)) {
      if (!composer.unconfirmed) continue;
      const workspace = useWorkbenchStore.getState().workspaces.find((w) => w.views.some((v) => v.id === viewId));
      if (workspace) confirmLate({ workspaceId: workspace.id, viewId });
    }
  });
}

export function registerComposerContributions(): void {
  rememberConversations();
  confirmLateDeliveries();
  window.workbench.agent.onProvidersChanged(rememberAgentModels);
  services.promptContributors.register({ id: "prompt-menus", contributions: (target) => {
    const selections = stateFor(target)?.promptSelections ?? {};
    const menus = services.promptMenus.resolve(target);
    const everyOption = menus.flatMap((item) => item.options);
    return menus.flatMap(({ menu, options }) => resolveOptions(options, selections, everyOption).map((resolved) => ({
      id: `${menu.id}:${resolved.id}`, source: `${menu.label}: ${resolved.summary}`, kind: menu.kind,
      content: resolved.text, enabled: true, placement: menu.placement,
    })));
  } });
  services.promptContributors.register({ id: "attachments", contributions: (target) => {
    const attachments = stateFor(target)?.attachments ?? [];
    return attachments.length ? [{ id: "attachments", kind: "attachment", enabled: true, content: attachmentsPrompt(attachments),
      source: attachments.length === 1 ? attachments[0].name : `${attachments.length} attachments` }] : [];
  } });
  services.commands.register<ComposerTarget & { files: File[] }>("agent.composer.attach", ({ files, ...target }) => attachFiles(target, files));
  services.commands.register<ComposerTarget & { entryId: string }>("agent.composer.recall", (target) => {
    const entry = useComposerState.getState().views[target.viewId]?.history.find((item) => item.id === target.entryId);
    if (!entry || !exists(target)) return;
    const current = stateFor(target);
    if ((current?.draft?.trim() || current?.attachments?.length) && !remember(target.viewId, entryFor(target, "saved", "Draft saved before recall."))) {
      throw new Error("The current draft is too large for recent history. Copy it before replacing it.");
    }
    patchComposer(target, {
      draft: entry.draft, attachments: entry.attachments, intent: entry.preview.intent,
    });
  });
  services.commands.register<ComposerTarget>("agent.composer.send", async (target) => {
    const runtime = useAgentRuntimes.getState().sessions[target.viewId];
    if (!runtime || !stateFor(target)?.draft?.trim() || useComposerState.getState().views[target.viewId]?.sending) return;
    // Model and effort are launch arguments. Nothing has gone to this conversation yet, so start it again with the
    // ones chosen in the composer, then send.
    if (isUnusedConversation(runtime) && pendingSettings(runtime, stateFor(target)) !== undefined) {
      closeAgentRuntime(target.viewId);
      await services.commands.execute("agent.session.launch", { ...target, providerId: runtime.providerId });
      return;
    }
    // The CLI is still starting (or asking something in the terminal): hold the prompt until it can take one.
    // A first prompt for Plan also waits out startup work, since the CLI can only change mode while idle. A follow-up
    // to a working turn is not held: the send is refused and the person decides.
    const planningFirst = stateFor(target)?.intent === "plan" && !runtime.prompted;
    if (!runtime.status?.canSubmit || (planningFirst && runtime.status.activity !== "ready")) {
      const lifecycle = runtime.status?.lifecycle;
      if (lifecycle === "exited" || lifecycle === "failed") { notSent(target.viewId, runtime.status?.reason ?? "The CLI stopped."); return; }
      if (useComposerState.getState().views[target.viewId]?.launching) return;
      updateRuntime(target.viewId, { launching: true, result: undefined });
      try { await untilSubmittable(runtime.controller, planningFirst); }
      catch (error) { updateRuntime(target.viewId, { launching: false }); notSent(target.viewId, errorMessage(error)); return; }
      updateRuntime(target.viewId, { launching: false });
      if (!exists(target)) return;
    }
    const state = stateFor(target);
    if (!state?.draft?.trim()) return;
    const entry = entryFor(target, "not-sent", "");
    if (entry.preview.content.length > 500_000) {
      notSent(target.viewId, "The composed prompt exceeds 500,000 characters. Shorten the prompt or remove attachments.");
      return;
    }
    if (/^\s*[/!]/.test(entry.draft)) {
      notSent(target.viewId, "Use native commands directly in the terminal.");
      return;
    }
    const revision = state.composerRevision ?? 0;
    updateRuntime(target.viewId, { sending: true, result: undefined, unconfirmed: undefined });
    const confirmedBefore = useAgentRuntimes.getState().sessions[target.viewId]?.status?.confirmedDeliveries ?? 0;
    let result: AgentDeliveryResult;
    try { result = await runtime.controller.sendPrompt({ prompt: entry.preview.content, intent: entry.preview.intent }); }
    catch { result = { outcome: "uncertain", stage: "unknown", message: "Delivery could not be confirmed. Inspect the terminal before retrying." }; }
    if (!exists(target)) return;
    remember(target.viewId, { ...entry, outcome: result.outcome, message: result.message });
    const unconfirmed = result.outcome === "uncertain" && result.stage === "enter" ? { entryId: entry.id, revision, controller: runtime.controller, confirmedBefore } : undefined;
    updateRuntime(target.viewId, { sending: false, result, unconfirmed });
    if (result.outcome !== "not-sent") markAgentPrompted(target.viewId);
    // The CLI may already have taken it while the result was on its way.
    if (unconfirmed) confirmLate(target);
    if (result.outcome !== "submitted") return;
    finishSubmitted(target, entry.draft, revision);
  });
  // The CLI starts when the first prompt is sent: prepare its folder, launch it, wait for its input, then deliver.
  // `providerId` is the harness shown as selected, which may be a default that was never saved to the view.
  services.commands.register<ComposerTarget & { providerId?: string }>("agent.session.launch", async ({ providerId, ...target }) => {
    const workspace = useWorkbenchStore.getState().workspaces.find((w) => w.id === target.workspaceId);
    const state = stateFor(target);
    const composer = useComposerState.getState().views[target.viewId];
    if (!workspace || !state?.draft?.trim() || composer?.launching || composer?.sending) return;
    // Sending from a conversation that's waiting to be reopened continues it.
    const reopen = reopening(target);
    const provider = reopen?.provider ?? services.sessions.get(providerId ?? state.providerId ?? "");
    if (provider?.kind !== "agent") { notSent(target.viewId, "Choose an available harness first."); return; }
    if (!reopen && needsModelChoice(provider.id, state.modelSettings?.[provider.id])) { notSent(target.viewId, "Choose a model first."); return; }
    if (state.providerId !== provider.id) patchView(target, { providerId: provider.id });
    updateRuntime(target.viewId, { launching: true, result: undefined, resumeError: undefined });
    try {
      const cwd = await prepareSessionFolder(target, Boolean(reopen));
      await untilSubmittable(await startAgentRuntime(target.viewId, provider, { workspacePath: cwd, resume: reopen?.resume, settings: reopen ? undefined : launchSettings(provider.id, target) }));
    } catch (error) {
      updateRuntime(target.viewId, { launching: false });
      notSent(target.viewId, errorMessage(error));
      return;
    }
    updateRuntime(target.viewId, { launching: false });
    await services.commands.execute("agent.composer.send", target);
  });
  // A new conversation with the composer's model and effort; the draft stays.
  services.commands.register<ComposerTarget>("agent.session.restart", async (target) => {
    const runtime = useAgentRuntimes.getState().sessions[target.viewId];
    const provider = services.sessions.get(runtime?.providerId ?? "");
    if (!runtime || provider?.kind !== "agent" || useComposerState.getState().views[target.viewId]?.sending) return;
    closeAgentRuntime(target.viewId);
    patchView(target, { conversation: null });
    updateRuntime(target.viewId, { result: undefined });
    try { await startAgentRuntime(target.viewId, provider, { workspacePath: await prepareSessionFolder(target), settings: launchSettings(provider.id, target) }); }
    catch (error) { notSent(target.viewId, errorMessage(error)); }
  });
  // Reopens the saved conversation in its folder. Only a click, or being the view the app opens on, gets here.
  services.commands.register<ComposerTarget>("agent.session.resume", async (target) => {
    const composer = useComposerState.getState().views[target.viewId];
    const reopen = reopening(target);
    if (!reopen || useAgentRuntimes.getState().sessions[target.viewId] || composer?.launching || composer?.sending) return;
    updateRuntime(target.viewId, { launching: true, result: undefined, resumeError: undefined });
    try { await startAgentRuntime(target.viewId, reopen.provider, { workspacePath: await prepareSessionFolder(target, true), resume: reopen.resume }); }
    catch (error) { updateRuntime(target.viewId, { resumeError: errorMessage(error) }); }
    finally { updateRuntime(target.viewId, { launching: false }); }
  });
  // Leaves the saved conversation (or a CLI that failed to reopen it) behind for a new one; the draft stays.
  services.commands.register<ComposerTarget>("agent.session.forget", (target) => {
    closeAgentRuntime(target.viewId);
    updateRuntime(target.viewId, { resumeError: undefined, result: undefined });
    patchView(target, { conversation: null, modelSettings: {} });
  });
  services.commands.register<ComposerTarget>("agent.session.reset", (target) => {
    closeAgentRuntime(target.viewId);
    clearComposerRuntime(target.viewId);
    patchView(target, { promptSelections: {}, conversation: null, modelSettings: {} });
    patchComposer(target, { draft: "", attachments: [], intent: "default" });
  });
}
