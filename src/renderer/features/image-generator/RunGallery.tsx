import { useEffect, useState } from "react";
import { Button as AriaButton, Dialog, Modal, ModalOverlay } from "react-aria-components";
import type { ImageRun, ImageRunManifest, ImageRunSnapshot } from "../../../shared/models";
import { errorMessage } from "../../core/errors";
import { services } from "../../core/services";
import { Button } from "../../ui/controls";
import { CheckIcon } from "../../ui/icons";
import { useImageRuntimes, type ImageTarget } from "./image-generator-state";

import { validateConcept } from "./concept-validation";

type Variant = ImageRunManifest["variants"][number];
const POLL_MS = 1500;
/** How long a completed run keeps being watched after a retry, until the agent reopens its manifest. */
const RETRY_GRACE_MS = 60_000;
/** A file that changed this recently may still be being written. */
const SETTLE_MS = 1000;
const imageCache = new Map<string, Promise<string>>();

/** Polls a run folder until the agent marks its manifest complete. */
function useRunSnapshot(viewId: string, runId: string): ImageRunSnapshot | undefined {
  const [snapshot, setSnapshot] = useState<ImageRunSnapshot>();
  const retriedAt = useImageRuntimes((s) => s.views[viewId]?.retriedAt?.[runId] ?? 0);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = () => {
      void window.workbench.images.inspectRun(viewId, runId).then((next) => {
        if (!active) return;
        setSnapshot(next);
        if (!next.manifest?.complete || Date.now() - retriedAt < RETRY_GRACE_MS) timer = setTimeout(poll, POLL_MS);
      }).catch(() => { if (active) timer = setTimeout(poll, POLL_MS * 4); });
    };
    poll();
    return () => { active = false; clearTimeout(timer); };
  }, [viewId, runId, retriedAt]);
  return snapshot;
}

function useImage(viewId: string, file: string | undefined, version: string): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!file) { setUrl(undefined); return; }
    let active = true;
    const key = `${viewId}/${file}@${version}`;
    let request = imageCache.get(key);
    if (!request) { request = window.workbench.images.read(viewId, file); imageCache.set(key, request); }
    request.then((value) => { if (active) setUrl(value); }).catch(() => { imageCache.delete(key); });
    return () => { active = false; };
  }, [viewId, file, version]);
  return url;
}

export function AttachmentThumb({ viewId, file, name }: { viewId: string; file: string; name: string }) {
  const url = useImage(viewId, file, "staged");
  return url ? <img src={url} alt={name} /> : <span className="image-thumb-placeholder" />;
}

function candidateFile(snapshot: ImageRunSnapshot | undefined, index: number) {
  const file = snapshot?.files.find((item) => item.name === `candidate-${index}.png`);
  if (!file) return undefined;
  const settled = Date.now() - file.modifiedAt > SETTLE_MS || snapshot?.manifest?.complete;
  return settled ? file : undefined;
}

function runStatus(run: ImageRun, snapshot: ImageRunSnapshot | undefined): { label: string; tone: "working" | "ready" | "error" | "attention" } {
  const manifest = snapshot?.manifest;
  if (run.error && !manifest) return { label: run.error, tone: "error" };
  if (!snapshot) return { label: "Loading…", tone: "working" };
  if (!manifest) return { label: "Writing variants…", tone: "working" };
  const done = manifest.variants.filter((variant) => variant.status === "done").length;
  const failed = manifest.variants.filter((variant) => variant.status === "failed").length;
  if (!manifest.complete) return { label: `Generating · ${done} of ${manifest.variants.length} ready`, tone: "working" };
  return failed ? { label: `${failed} of ${manifest.variants.length} failed`, tone: "attention" } : { label: "Done", tone: "ready" };
}

function CandidateImage({ viewId, run, snapshot, index, alt }: { viewId: string; run: ImageRun; snapshot?: ImageRunSnapshot; index: number; alt: string }) {
  const file = candidateFile(snapshot, index);
  const url = useImage(viewId, file && `${run.id}/${file.name}`, file ? `${file.size}:${file.modifiedAt}` : "");
  return url ? <img src={url} alt={alt} /> : null;
}

function useConceptCheck(viewId: string, run: ImageRun, snapshot: ImageRunSnapshot | undefined, index: number) {
  const file = candidateFile(snapshot, index);
  const url = useImage(viewId, file && `${run.id}/${file.name}`, file ? `${file.size}:${file.modifiedAt}` : '');
  const [check, setCheck] = useState<{ valid: boolean; message: string }>();
  useEffect(() => {
    let active = true; setCheck(undefined);
    if (url) void validateConcept(url).then(result => { if (active) setCheck(result); }).catch(error => { if (active) setCheck({ valid: false, message: String(error) }); });
    return () => { active = false; };
  }, [url]);
  return check;
}

function CandidateCard({ target, run, snapshot, index, variant, onOpen }: {
  target: ImageTarget; run: ImageRun; snapshot?: ImageRunSnapshot; index: number; variant?: Variant; onOpen: () => void;
}) {
  const ready = Boolean(candidateFile(snapshot, index));
  const check = useConceptCheck(target.viewId, run, snapshot, index);
  const failed = variant?.status === "failed" && !ready;
  const chosen = run.chosen === index;
  const title = variant?.title ?? `Variant ${index}`;
  return <article className={`image-card ${chosen ? "is-chosen" : ""}`} aria-label={title}>
    <AriaButton className="image-card-frame" isDisabled={!ready} onPress={onOpen} aria-label={`Open ${title}`}>
      {ready ? <CandidateImage viewId={target.viewId} run={run} snapshot={snapshot} index={index} alt={title} />
        : <span className={`image-card-pending ${failed ? "is-failed" : ""}`}>{failed ? variant?.error || "Generation failed" : variant ? "Generating…" : "Waiting for a variant…"}</span>}
      {chosen && <span className="image-card-badge"><CheckIcon size={12} />Chosen</span>}
    </AriaButton>
    <div className="image-card-body">
      <h4>{index}. {title}</h4>
      {variant?.changes && <p title={variant.changes}>{variant.changes}</p>}
      {ready && <p role="status">{check?.message ?? "Checking concept pixels…"}</p>}
    </div>
    <div className="image-card-actions">
      {failed
        ? <Button className="strip-button" onPress={() => void services.commands.execute("image.retry", { ...target, runId: run.id, index })}>Retry</Button>
        : <Button className="strip-button" isDisabled={!check?.valid} onPress={() => void services.commands.execute("image.choose", { ...target, runId: run.id, index: chosen ? undefined : index })}>
          {chosen ? "Unchoose" : "Choose"}
        </Button>}
    </div>
  </article>;
}

function Lightbox({ target, run, snapshot, index, variant, onClose }: {
  target: ImageTarget; run: ImageRun; snapshot?: ImageRunSnapshot; index: number; variant?: Variant; onClose: () => void;
}) {
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const title = variant?.title ?? `Variant ${index}`;
  const check = useConceptCheck(target.viewId, run, snapshot, index);
  const file = `${run.id}/candidate-${index}.png`;
  const chosen = run.chosen === index;
  const act = (id: string, args: object) => services.commands.execute(id, { ...target, ...args }).catch((e: unknown) => setError(errorMessage(e)));
  return <ModalOverlay className="wb-modal-overlay" isDismissable isOpen onOpenChange={(open) => { if (!open) onClose(); }}>
    <Modal className="wb-modal image-lightbox"><Dialog aria-label={title} className="wb-dialog">
      <div className="dialog-header"><div><h2>{index}. {title}</h2><p>{variant?.changes}</p></div><Button onPress={onClose}>Close</Button></div>
      <div className="image-lightbox-body">
        <div className="image-lightbox-frame"><CandidateImage viewId={target.viewId} run={run} snapshot={snapshot} index={index} alt={title} /></div>
        <aside>
          <h3>Prompt</h3>
          <pre className="prompt-preview-text">{variant?.prompt ?? "The manifest has no prompt for this variant."}</pre>
          <p role="status">{check?.message ?? "Checking concept pixels…"}</p>
          <h3>Sources</h3>
          <p>{variant?.sources.length ? variant.sources.map((source) => run.sources.find((item) => item.file === source)?.name ?? source).join(", ") : "None"}</p>
          {error && <p className="image-error" role="alert">{error}</p>}
          <div className="image-lightbox-actions">
            <Button isDisabled={!check?.valid} onPress={() => void act("image.choose", { runId: run.id, index: chosen ? undefined : index })}>{chosen ? "Unchoose" : "Choose"}</Button>
            <Button onPress={() => { void navigator.clipboard.writeText(variant?.prompt ?? "").then(() => setCopied(true)); }}>{copied ? "Copied prompt" : "Copy prompt"}</Button>
            <Button onPress={() => window.workbench.images.reveal(target.viewId, file)}>Reveal in Finder</Button>
            <Button onPress={() => void act("image.refine", { file, name: `${title}.png`, prompt: run.prompt }).then(onClose)}>Refine from this</Button>
            <Button onPress={() => void act("image.retry", { runId: run.id, index }).then(onClose)}>Regenerate</Button>
          </div>
        </aside>
      </div>
    </Dialog></Modal>
  </ModalOverlay>;
}

export function RunSection({ target, run }: { target: ImageTarget; run: ImageRun }) {
  const snapshot = useRunSnapshot(target.viewId, run.id);
  const [open, setOpen] = useState<number>();
  const status = runStatus(run, snapshot);
  const variants = snapshot?.manifest?.variants ?? [];
  const indexes = Array.from({ length: Math.max(run.count, ...variants.map((variant) => variant.index)) }, (_, i) => i + 1);
  const variantAt = (index: number) => variants.find((variant) => variant.index === index);
  return <section className="image-run" aria-label={`Run: ${run.prompt}`}>
    <header className="image-run-header">
      <div className="image-run-title">
        <p title={run.prompt}>{run.prompt}</p>
        <small>{new Date(run.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
          {run.sources.length > 0 && ` · ${run.sources.length} source image${run.sources.length === 1 ? "" : "s"}`}</small>
      </div>
      <span className={`session-pill tone-${status.tone}`}><span className="status-dot" />{status.label}</span>
    </header>
    {!(run.error && !snapshot?.manifest) && <div className="image-grid">
      {indexes.map((index) => <CandidateCard key={index} target={target} run={run} snapshot={snapshot} index={index} variant={variantAt(index)} onOpen={() => setOpen(index)} />)}
    </div>}
    {open !== undefined && <Lightbox target={target} run={run} snapshot={snapshot} index={open} variant={variantAt(open)} onClose={() => setOpen(undefined)} />}
  </section>;
}
