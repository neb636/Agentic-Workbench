import { useSyncExternalStore } from "react";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { IconButton } from "./controls";
import { CloseIcon, TrashIcon } from "./icons";
import { answerConfirmation as finish, pendingConfirmation } from "./confirm";

/** Mounted once by the shell; shows whatever `confirmDestructive` is asking. */
export function ConfirmDialogHost() {
  const request = useSyncExternalStore(pendingConfirmation.subscribe, pendingConfirmation.get);
  if (!request) return null;
  const { subject } = request;
  return <ModalOverlay className="wb-modal-overlay confirm-overlay" isOpen isDismissable onOpenChange={(open) => { if (!open) finish(false); }}>
    <Modal className="wb-modal wb-alert confirm-modal">
      <Dialog role="alertdialog" className="wb-dialog confirm-dialog">
        <div className="confirm-header">
          <div>
            <Heading slot="title">{request.title}</Heading>
            <p>{request.message}</p>
          </div>
          <IconButton label="Cancel" className="confirm-close" onPress={() => finish(false)}><CloseIcon size={14} /></IconButton>
        </div>
        <div className="confirm-warning" role="note"><p>{request.warning}</p></div>
        <div className="confirm-subject">
          <span className="confirm-subject-icon" aria-hidden="true">{subject.icon}</span>
          <span className="confirm-subject-copy">
            <strong>{subject.name}</strong>
            {subject.detail && <small>{subject.detail}</small>}
            {subject.meta && <code className="confirm-subject-meta" title={subject.meta}><bdi>{subject.meta}</bdi></code>}
          </span>
        </div>
        <div className="dialog-actions confirm-actions">
          {/* Focus starts on Cancel, so Enter never removes anything by accident. */}
          <Button autoFocus className="wb-button confirm-cancel" onPress={() => finish(false)}>Cancel</Button>
          {request.tone === "caution"
            ? <Button className="wb-button primary-button" onPress={() => finish(true)}>{request.confirmLabel}</Button>
            : <Button className="wb-button danger-button" onPress={() => finish(true)}><TrashIcon size={14} />{request.confirmLabel}</Button>}
        </div>
      </Dialog>
    </Modal>
  </ModalOverlay>;
}
