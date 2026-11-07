import { create } from "zustand";
import type { ImageAttachment, ImageGeneratorViewState, ImageRun } from "../../../shared/models";
import { startAgentRuntime, untilSubmittable } from "../../core/agent-runtimes";
import { errorMessage } from "../../core/errors";
import { createId } from "../../core/id";
import { services } from "../../core/services";
import type { AgentSessionController } from "../../core/session-provider-registry";
import { useWorkbenchStore } from "../../state/workbench-store";
import { orchestrationPrompt, retryPrompt } from "./orchestration-prompt";

export interface ImageTarget { workspaceId: string; viewId: string; }
export const DEFAULT_PROVIDER = "claude.cli";
export const DEFAULT_COUNT = 1;
const LAUNCH_PROFILE = "image-generator";
const RUN_LIMIT = 30;

interface ImageRuntime {
  sending: boolean;
  error?: string;
  /** When a variant was last sent for regeneration, by run, so galleries resume watching a completed run. */
  retriedAt?: Record<string, number>;
}
export const useImageRuntimes = create<{ views: Record<string, ImageRuntime> }>(() => ({ views: {} }));
export const emptyImageRuntime: ImageRuntime = { sending: false };

function updateRuntime(viewId: string, patch: Partial<ImageRuntime>): void {
  useImageRuntimes.setState((state) => ({ views: { ...state.views, [viewId]: { ...(state.views[viewId] ?? emptyImageRuntime), ...patch } } }));
}
export function clearImageRuntime(viewId: string): void {
  useImageRuntimes.setState((state) => { const views = { ...state.views }; delete views[viewId]; return { views }; });
}

export function imageStateFor({ workspaceId, viewId }: ImageTarget): ImageGeneratorViewState | undefined {
  return useWorkbenchStore.getState().workspaces.find((w) => w.id === workspaceId)?.views.find((v) => v.id === viewId)?.state as ImageGeneratorViewState | undefined;
}
export function patchImageView(target: ImageTarget, patch: Partial<ImageGeneratorViewState>): void {
  useWorkbenchStore.getState().updateViewState(target.workspaceId, target.viewId, patch);
}
function patchRun(target: ImageTarget, runId: string, patch: Partial<ImageRun>): void {
  patchImageView(target, { runs: (imageStateFor(target)?.runs ?? []).map((run) => run.id === runId ? { ...run, ...patch } : run) });
}

export async function attachImages(target: ImageTarget, files: File[]): Promise<void> {
  const images = files.filter((file) => file.type.startsWith("image/"));
  if (!images.length) return;
  updateRuntime(target.viewId, { error: undefined });
  const added: ImageAttachment[] = [];
  try {
    for (const file of images) added.push(await window.workbench.images.importData(target.viewId, file.name, new Uint8Array(await file.arrayBuffer())));
  } catch (error) { updateRuntime(target.viewId, { error: errorMessage(error) }); }
  if (added.length) patchImageView(target, { attachments: [...(imageStateFor(target)?.attachments ?? []), ...added] });
}

/** Reuses this view's agent, launching it in the image folder with the image launch profile the first time. */
async function agentFor(target: ImageTarget): Promise<AgentSessionController> {
  const providerId = imageStateFor(target)?.providerId ?? DEFAULT_PROVIDER;
  const provider = services.sessions.get(providerId);
  if (provider?.kind !== "agent") throw new Error("The image agent is not available. Install the selected CLI, then try again.");
  const folder = await window.workbench.images.folder(target.viewId);
  const controller = await startAgentRuntime(target.viewId, provider, { workspacePath: folder, ...(providerId === "claude.cli" ? { profile: LAUNCH_PROFILE } : {}) });
  await untilSubmittable(controller);
  return controller;
}

async function deliver(target: ImageTarget, prompt: string): Promise<string | undefined> {
  const result = await (await agentFor(target)).sendPrompt({ prompt, intent: "default" });
  if (result.outcome === "submitted") return undefined;
  return result.outcome === "uncertain" ? `Delivery uncertain. ${result.message}` : `Not sent. ${result.message}`;
}

function titleFromPrompt(draft: string): string {
  const line = draft.trim().split("\n")[0].trim();
  return line.length > 40 ? `${line.slice(0, 39).trimEnd()}…` : line;
}

export function registerImageGeneratorCommands(): void {
  services.commands.register<ImageTarget>("image.generate", async (target) => {
    const state = imageStateFor(target);
    const request = state?.draft?.trim();
    if (!state || !request || useImageRuntimes.getState().views[target.viewId]?.sending) return;
    updateRuntime(target.viewId, { sending: true, error: undefined });
    const attachments = state.attachments ?? [];
    const run: ImageRun = { id: createId("run"), createdAt: Date.now(), prompt: request, sources: [], count: 1 };
    try {
      const prepared = await window.workbench.images.prepareRun(target.viewId, run.id, attachments.map((item) => item.file));
      run.sources = prepared.sources.map((file, index) => ({ file, name: attachments[index].name }));
      patchImageView(target, { runs: [run, ...(state.runs ?? [])].slice(0, RUN_LIMIT) });
      const error = await deliver(target, orchestrationPrompt({ dir: prepared.dir, request, count: run.count, sources: run.sources }));
      if (error) { patchRun(target, run.id, { error }); return; }
      patchImageView(target, { draft: "", attachments: [] });
      if (imageStateFor(target)?.autoTitle) {
        useWorkbenchStore.getState().renameView(target.workspaceId, target.viewId, titleFromPrompt(request));
        patchImageView(target, { autoTitle: false });
      }
    } catch (error) {
      if (imageStateFor(target)?.runs?.some((item) => item.id === run.id)) patchRun(target, run.id, { error: errorMessage(error) });
      else updateRuntime(target.viewId, { error: errorMessage(error) });
    } finally { updateRuntime(target.viewId, { sending: false }); }
  });

  services.commands.register<ImageTarget & { runId: string; index: number }>("image.retry", async ({ runId, index, ...target }) => {
    if (useImageRuntimes.getState().views[target.viewId]?.sending) return;
    updateRuntime(target.viewId, { sending: true, error: undefined });
    try {
      const folder = await window.workbench.images.folder(target.viewId);
      const error = await deliver(target, retryPrompt({ dir: `${folder}/${runId}`, index }));
      if (error) updateRuntime(target.viewId, { error });
      else updateRuntime(target.viewId, { retriedAt: { ...useImageRuntimes.getState().views[target.viewId]?.retriedAt, [runId]: Date.now() } });
    } catch (error) { updateRuntime(target.viewId, { error: errorMessage(error) }); }
    finally { updateRuntime(target.viewId, { sending: false }); }
  });

  services.commands.register<ImageTarget & { runId: string; index?: number }>("image.choose", ({ runId, index, ...target }) => {
    patchRun(target, runId, { chosen: index });
  });

  // Starts a new request from a candidate: the image becomes an attachment and its prompt the draft.
  services.commands.register<ImageTarget & { file: string; name: string; prompt: string }>("image.refine", async ({ file, name, ...target }) => {
    const bytes = new Uint8Array(await (await fetch(await window.workbench.images.read(target.viewId, file))).arrayBuffer());
    const attachment = await window.workbench.images.importData(target.viewId, name, bytes);
    patchImageView(target, { attachments: [attachment], draft: "Redraw the SAME attached character. Change only: " });
  });
}
