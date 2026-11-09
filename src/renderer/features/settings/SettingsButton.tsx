import { Button as AriaButton, Dialog, DialogTrigger, Modal, ModalOverlay, Tab, TabList, TabPanel, Tabs } from "react-aria-components";
import { useWorkbenchStore } from "../../state/workbench-store";
import { Button } from "../../ui/controls";
import { SettingsIcon } from "../../ui/icons";
import { InstructionsManager } from "../instructions/InstructionsManager";
import { PersonaManager } from "../personas/PersonaManager";
import { GeneralSettings } from "./GeneralSettings";

export function SettingsButton() {
  const workspaceId = useWorkbenchStore((state) => state.activeWorkspaceId ?? state.workspaces[0]?.id ?? "");
  return <DialogTrigger>
    <AriaButton className="sidebar-nav-item"><SettingsIcon size={15} /><span>Settings</span></AriaButton>
    <ModalOverlay className="wb-modal-overlay" isDismissable>
      <Modal className="wb-modal">
        <Dialog aria-label="Settings" className="wb-dialog">
          {({ close }) => <>
            <div className="dialog-header"><div><h2>Settings</h2><p>Built-in AI, prompt composer personas and instructions.</p></div><Button onPress={close}>Done</Button></div>
            <Tabs className="settings-tabs">
              <TabList aria-label="Settings sections" className="segmented">
                <Tab id="general" className="segment">General</Tab>
                <Tab id="personas" className="segment">Personas</Tab>
                <Tab id="instructions" className="segment">Instructions</Tab>
              </TabList>
              <TabPanel id="general"><GeneralSettings /></TabPanel>
              <TabPanel id="personas"><PersonaManager workspaceId={workspaceId} /></TabPanel>
              <TabPanel id="instructions"><InstructionsManager workspaceId={workspaceId} /></TabPanel>
            </Tabs>
          </>}
        </Dialog>
      </Modal>
    </ModalOverlay>
  </DialogTrigger>;
}
