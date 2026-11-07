import { Button as AriaButton, Dialog, DialogTrigger, Modal, ModalOverlay } from "react-aria-components";
import { useWorkbenchStore } from "../../state/workbench-store";
import { Button } from "../../ui/controls";
import { SettingsIcon } from "../../ui/icons";
import { InstructionsManager } from "../instructions/InstructionsManager";

export function SettingsButton() {
  const workspaceId = useWorkbenchStore((state) => state.activeWorkspaceId ?? state.workspaces[0]?.id ?? "");
  return <DialogTrigger>
    <AriaButton className="sidebar-nav-item"><SettingsIcon size={15} /><span>Settings</span></AriaButton>
    <ModalOverlay className="wb-modal-overlay" isDismissable>
      <Modal className="wb-modal">
        <Dialog aria-label="Settings" className="wb-dialog">
          {({ close }) => <>
            <div className="dialog-header"><div><h2>Settings</h2><p>Prompt composer instructions.</p></div><Button onPress={close}>Done</Button></div>
            <InstructionsManager workspaceId={workspaceId} />
          </>}
        </Dialog>
      </Modal>
    </ModalOverlay>
  </DialogTrigger>;
}
