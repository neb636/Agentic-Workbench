import { create } from "zustand";
import type { AgentDeliveryResult, AgentModelSettings, AgentPromptRequest, AgentViewState, PromptQuotation } from "../../../shared/models";
import { resetSelections, resolveOptions, type PromptSelections } from "../../../shared/prompt-options";
import type { AssembledPrompt } from "../../core/prompt-assembler";
import { createId } from "../../core/id";
import { errorMessage } from "../../core/errors";
import { services } from "../../core/services";
import { closeAgentRuntime, isUnusedConversation, markAgentPrompted, startAgentRuntime, untilSubmittable, useAgentRuntimes, type AgentRuntime } from "../../core/agent-runtimes";
import { useWorkbenchStore } from "../../state/workbench-store";
import { modelSettings } from "./agent-models";

export interface ComposerTarget { workspaceId: string; viewId: string; }
export interface PromptPreview extends AssembledPrompt { intent: AgentPromptRequest["intent"]; }
export interface PromptHistoryEntry {
  id: string;
  createdAt: number;
  draft: string;
  quotations: PromptQuotation[];
  preview: PromptPreview;
  outcome: AgentDeliveryResult["outcome"] | "saved";
  message: string;
}
interface ComposerRuntime {
  history: PromptHistoryEntry[];
  sending: boolean;
  launching: boolean;
  result?: AgentDeliveryResult;
}
const emptyRuntime: ComposerRuntime = { history: [], sending: false, launching: false };
export const useComposerState = create<{ views: Record<string, ComposerRuntime> }>(() => ({ views: {} }));
export const emptyComposerRuntime = emptyRuntime;

function stateFor({ workspaceId, viewId }: ComposerTarget): AgentViewState | undefined {
  return useWorkbenchStore.getState().workspaces.find((w) => w.id === workspaceId)?.views.find((v) => v.id === viewId)?.state as AgentViewState | undefined;
}
function patchView(target: ComposerTarget, patch: Partial<AgentViewState>): void {
  useWorkbenchStore.getState().updateViewState(target.workspaceId, target.viewId, patch);
}
export function patchComposer(target: ComposerTarget, patch: Pick<AgentViewState, "draft" | "quotations" | "intent" | "modelSettings">): void {
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
function previewFor(target: ComposerTarget): PromptPreview {
  const state = stateFor(target);
  return { ...services.promptAssembler.assemble(state?.draft ?? "", services.promptContributors.collect(target)), intent: state?.intent ?? "default" };
}
function entryFor(target: ComposerTarget, outcome: PromptHistoryEntry["outcome"], message: string): PromptHistoryEntry {
  const state = stateFor(target);
  return { id: createId("prompt"), createdAt: Date.now(), draft: state?.draft ?? "", quotations: [...(state?.quotations ?? [])], preview: previewFor(target), outcome, message };
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
 * The composer's model and effort when they differ from what the running conversation was launched with
 * (null: the CLI's defaults). Undefined when nothing is pending, or for a resumed conversation, whose settings are its own.
 */
export function pendingSettings(runtime: AgentRuntime | undefined, state: AgentViewState | undefined): AgentModelSettings | null | undefined {
  if (!runtime || runtime.settings === undefined) return undefined;
  const wanted = modelSettings(runtime.providerId, state?.modelSettings?.[runtime.providerId]);
  return sameSettings(wanted, runtime.settings) ? undefined : wanted;
}
function launchSettings(providerId: string, target: ComposerTarget): AgentModelSettings | undefined {
  return modelSettings(providerId, stateFor(target)?.modelSettings?.[providerId]) ?? undefined;
}

function titleFromPrompt(draft: string): string {
  const line = draft.trim().split("\n")[0].trim();
  return line.length > 40 ? `${line.slice(0, 39).trimEnd()}…` : line;
}

export function registerComposerContributions(): void {
  services.promptContributors.register({ id: "prompt-menus", contributions: (target) => {
    const selections = stateFor(target)?.promptSelections ?? {};
    const menus = services.promptMenus.resolve(target);
    const everyOption = menus.flatMap((item) => item.options);
    return menus.flatMap(({ menu, options }) => resolveOptions(options, selections, everyOption).map((resolved) => ({
      id: `${menu.id}:${resolved.id}`, source: `${menu.label}: ${resolved.summary}`, kind: menu.kind,
      content: resolved.text, enabled: true, placement: menu.placement,
    })));
  } });
  services.promptContributors.register({ id: "terminal-quotations", contributions: (target) =>
    (stateFor(target)?.quotations ?? []).map((quote, index) => ({ id: quote.id, kind: "context", source: `Terminal selection ${index + 1}`,
      enabled: true, content: `Terminal selection ${index + 1}:\n${quote.content.split("\n").map((line) => `> ${line}`).join("\n")}` })),
  });
  services.commands.register<ComposerTarget, PromptPreview>("agent.composer.preview", previewFor);
  services.commands.register<ComposerTarget & { text: string }>("agent.composer.quote", (target) => {
    if (!exists(target) || !target.text.trim()) return;
    // A quotation is text, never a terminal control sequence.
    // eslint-disable-next-line no-control-regex
    const content = target.text.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
    const quotations = [...(stateFor(target)?.quotations ?? []), { id: createId("quote"), content }];
    patchComposer(target, { quotations });
  });
  services.commands.register<ComposerTarget & { entryId: string }>("agent.composer.recall", (target) => {
    const entry = useComposerState.getState().views[target.viewId]?.history.find((item) => item.id === target.entryId);
    if (!entry || !exists(target)) return;
    const current = stateFor(target);
    if ((current?.draft?.trim() || current?.quotations?.length) && !remember(target.viewId, entryFor(target, "saved", "Draft saved before recall."))) {
      throw new Error("The current draft is too large for recent history. Copy it before replacing it.");
    }
    patchComposer(target, {
      draft: entry.draft, quotations: entry.quotations, intent: entry.preview.intent,
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
    if (!runtime.status?.canSubmit) {
      const lifecycle = runtime.status?.lifecycle;
      if (lifecycle === "exited" || lifecycle === "failed") { notSent(target.viewId, runtime.status?.reason ?? "The CLI stopped."); return; }
      if (useComposerState.getState().views[target.viewId]?.launching) return;
      updateRuntime(target.viewId, { launching: true, result: undefined });
      try { await untilSubmittable(runtime.controller); }
      catch (error) { updateRuntime(target.viewId, { launching: false }); notSent(target.viewId, errorMessage(error)); return; }
      updateRuntime(target.viewId, { launching: false });
      if (!exists(target)) return;
    }
    const state = stateFor(target);
    if (!state?.draft?.trim()) return;
    const entry = entryFor(target, "not-sent", "");
    if (entry.preview.content.length > 500_000) {
      notSent(target.viewId, "The composed prompt exceeds 500,000 characters. Shorten the prompt or remove quoted context.");
      return;
    }
    if (/^\s*[/!]/.test(entry.draft)) {
      notSent(target.viewId, "Use native commands directly in the terminal.");
      return;
    }
    const revision = state.composerRevision ?? 0;
    updateRuntime(target.viewId, { sending: true, result: undefined });
    let result: AgentDeliveryResult;
    try { result = await runtime.controller.sendPrompt({ prompt: entry.preview.content, intent: entry.preview.intent }); }
    catch { result = { outcome: "uncertain", stage: "unknown", message: "Delivery could not be confirmed. Inspect the terminal before retrying." }; }
    if (!exists(target)) return;
    remember(target.viewId, { ...entry, outcome: result.outcome, message: result.message });
    updateRuntime(target.viewId, { sending: false, result });
    if (result.outcome !== "not-sent") markAgentPrompted(target.viewId);
    if (result.outcome !== "submitted") return;
    resetMenusAfterSend(target);
    if (stateFor(target)?.autoTitle && entry.draft.trim()) {
      useWorkbenchStore.getState().renameView(target.workspaceId, target.viewId, titleFromPrompt(entry.draft));
      patchView(target, { autoTitle: false });
    }
    if ((stateFor(target)?.composerRevision ?? 0) === revision) {
      patchComposer(target, { draft: "", quotations: [], intent: "default" });
    }
  });
  // The CLI starts when the first prompt is sent: prepare its folder, launch it, wait for its input, then deliver.
  // `providerId` is the harness shown as selected, which may be a default that was never saved to the view.
  services.commands.register<ComposerTarget & { providerId?: string }>("agent.session.launch", async ({ providerId, ...target }) => {
    const workspace = useWorkbenchStore.getState().workspaces.find((w) => w.id === target.workspaceId);
    const state = stateFor(target);
    const composer = useComposerState.getState().views[target.viewId];
    if (!workspace || !state?.draft?.trim() || composer?.launching || composer?.sending) return;
    const provider = services.sessions.get(providerId ?? state.providerId ?? "");
    if (provider?.kind !== "agent") { notSent(target.viewId, "Choose an available harness first."); return; }
    if (state.providerId !== provider.id) patchView(target, { providerId: provider.id });
    updateRuntime(target.viewId, { launching: true, result: undefined });
    try {
      const cwd = await prepareSessionFolder(target);
      await untilSubmittable(await startAgentRuntime(target.viewId, provider, { workspacePath: cwd, settings: launchSettings(provider.id, target) }));
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
    updateRuntime(target.viewId, { result: undefined });
    try { await startAgentRuntime(target.viewId, provider, { workspacePath: await prepareSessionFolder(target), settings: launchSettings(provider.id, target) }); }
    catch (error) { notSent(target.viewId, errorMessage(error)); }
  });
  services.commands.register<ComposerTarget>("agent.session.reset", (target) => {
    closeAgentRuntime(target.viewId);
    clearComposerRuntime(target.viewId);
    patchView(target, { promptSelections: {} });
    patchComposer(target, { draft: "", quotations: [], intent: "default" });
  });
}
