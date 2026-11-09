import { useContextMenu } from "../../ui/ContextMenu";
import { useEffect, useState } from "react";
import type { PromptAttachment } from "../../../shared/models";
import { IconButton } from "../../ui/controls";
import { CloseIcon, FileIcon } from "../../ui/icons";

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
  const [stem, kind] = nameParts(attachment.name);
  return <li tabIndex={0} {...menu.bind(() => actions)} className="attachment-tile" title={`${attachment.name} · ${sizeLabel(attachment.size)}`}>
    {thumbnail
      ? <img src={thumbnail} alt={attachment.name} draggable={false} onError={() => setThumbnail(null)} />
      : <div className="attachment-file"><FileIcon size={17} /><span className="attachment-stem">{stem}</span>{kind && <span className="attachment-kind">{kind}</span>}</div>}
    {menu.overlay}
    {menu.overflow(actions, attachment.name)}
    <IconButton label={`Remove ${attachment.name}`} className="attachment-remove" onPress={onRemove}><CloseIcon size={12} /></IconButton>
  </li>;
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
