import { useContextMenu } from "../../ui/ContextMenu";
import { useEffect, useState } from "react";
import { Button as AriaButton, Dialog, Modal, ModalOverlay } from "react-aria-components";
import type { PromptAttachment } from "../../../shared/models";
import { IconButton } from "../../ui/controls";
import { CloseIcon, ExpandIcon, FileIcon } from "../../ui/icons";

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "report.final.pdf" as ["report.final", "PDF"]: the kind stays readable when the name is cut off. */
function nameParts(name: string): [string, string] {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? [name.slice(0, dot), name.slice(dot + 1).toUpperCase()] : [name, ""];
}

function AttachmentTile({ viewId, attachment, onRemove }: { viewId: string; attachment: PromptAttachment; onRemove: () => void }) {
  const menu = useContextMenu("Attachment actions");
  const actions = [{ id: "copy", label: "Copy Filename", run: () => navigator.clipboard.writeText(attachment.name) }, { id: "remove", label: "Remove Attachment", destructive: true, run: onRemove }];
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  useEffect(() => {
    if (!attachment.image) return;
    let active = true;
    void window.workbench.attachments.thumbnail(viewId, attachment.id).then((url) => { if (active) setThumbnail(url); }).catch(() => undefined);
    return () => { active = false; };
  }, [viewId, attachment.id, attachment.image]);
  const [previewing, setPreviewing] = useState(false);
  const [stem, kind] = nameParts(attachment.name);
  // The preview sits outside the tile: React events bubble through portals, and a right-click on it isn't one on the tile.
  return <>
    {/* With a thumbnail the button below is the tab stop; the tile only takes focus back from its context menu. */}
    <li tabIndex={thumbnail ? -1 : 0} {...menu.bind(() => actions)} className="attachment-tile" title={`${attachment.name} · ${sizeLabel(attachment.size)}`}>
      {thumbnail
        ? <AriaButton className="attachment-preview-trigger" aria-label={`Preview ${attachment.name}`} onPress={() => setPreviewing(true)}>
          <img src={thumbnail} alt={attachment.name} draggable={false} onError={() => setThumbnail(null)} />
          <span className="attachment-preview-hint"><ExpandIcon size={14} /></span>
        </AriaButton>
        : <div className="attachment-file"><FileIcon size={17} /><span className="attachment-stem">{stem}</span>{kind && <span className="attachment-kind">{kind}</span>}</div>}
      {menu.overlay}
      {menu.overflow(actions, attachment.name)}
      <IconButton label={`Remove ${attachment.name}`} className="attachment-remove" onPress={onRemove}><CloseIcon size={12} /></IconButton>
    </li>
    {thumbnail && <ModalOverlay className="wb-modal-overlay image-preview-overlay" isDismissable isOpen={previewing} onOpenChange={setPreviewing}>
      <Modal className="image-preview">
        <Dialog aria-label={`Preview of ${attachment.name}`} className="image-preview-dialog">
          <ImagePreview viewId={viewId} attachment={attachment} thumbnail={thumbnail} />
          <IconButton label="Close preview" className="image-preview-close" onPress={() => setPreviewing(false)}><CloseIcon size={16} /></IconButton>
        </Dialog>
      </Modal>
    </ModalOverlay>}
  </>;
}

type LoadedImage = { url: string; width: number; height: number };

/** Decodes before showing, so the picture arrives whole and at its final size. Unmounts with the dialog, releasing the full image. */
function ImagePreview({ viewId, attachment, thumbnail }: { viewId: string; attachment: PromptAttachment; thumbnail: string }) {
  const [image, setImage] = useState<LoadedImage | "failed">();
  useEffect(() => {
    let active = true;
    const load = async (): Promise<LoadedImage> => {
      const url = await window.workbench.attachments.image(viewId, attachment.id);
      if (!url) throw new Error("The stored picture is gone.");
      const decoded = new Image();
      decoded.src = url;
      await decoded.decode();
      return { url, width: decoded.naturalWidth, height: decoded.naturalHeight };
    };
    void load().then((loaded) => { if (active) setImage(loaded); }, () => { if (active) setImage("failed"); });
    return () => { active = false; };
  }, [viewId, attachment.id]);
  const loaded = image && image !== "failed" ? image : undefined;
  // A vector picture without a set size has no dimensions worth listing.
  const details = [loaded?.width ? `${loaded.width} × ${loaded.height}` : "", sizeLabel(attachment.size)].filter(Boolean).join(" · ");
  return <figure className="image-preview-figure">
    {loaded
      ? <img className="image-preview-picture" src={loaded.url} alt={attachment.name} draggable={false} />
      : <img className={`image-preview-placeholder ${image === "failed" ? "is-failed" : ""}`} src={thumbnail} alt="" draggable={false} />}
    <figcaption className="image-preview-caption">
      <span className="image-preview-name">{attachment.name}</span>
      <span className="image-preview-details">{details}</span>
      {image === "failed" && <span className="image-preview-error" role="alert">Couldn’t load the full image</span>}
    </figcaption>
  </figure>;
}

/** The files going with the prompt, plus a placeholder for each one still being stored. */
export function ComposerAttachments({ viewId, attachments, pending, onRemove }: {
  viewId: string;
  attachments: PromptAttachment[];
  pending: number;
  onRemove: (id: string) => void;
}) {
  if (!attachments.length && !pending) return null;
  return <ul className="composer-attachments" aria-label={`Attachments: ${attachments.length}`}>
    {attachments.map((attachment) => <AttachmentTile key={attachment.id} viewId={viewId} attachment={attachment} onRemove={() => onRemove(attachment.id)} />)}
    {Array.from({ length: pending }, (_, index) => <li key={index} className="attachment-tile is-pending" aria-hidden="true" />)}
  </ul>;
}
