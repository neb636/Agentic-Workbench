import { useState } from "react";
import { Button } from "../../ui/controls";
import { Button as AriaButton, Label, ListBox, ListBoxItem, Popover, Select, SelectValue, Text } from "react-aria-components";
import { services } from "../../core/services";
import { useWorkbenchStore } from "../../state/workbench-store";
import { ChevronDownIcon } from "../../ui/icons";
import { useDefaultCli } from "./default-cli";

export function GeneralSettings() {
  const [storageNotice, setStorageNotice] = useState("");
  const { agents, current } = useDefaultCli();
  const setDefaultAgentProvider = useWorkbenchStore((state) => state.setDefaultAgentProvider);
  return <div className="general-settings">
    <Select placeholder="No CLI installed" selectedKey={current?.id ?? null} onSelectionChange={(key) => { if (key !== null) setDefaultAgentProvider(String(key)); }}>
      <Label>Default CLI</Label>
      <AriaButton className="select-trigger"><SelectValue /><ChevronDownIcon size={14} /></AriaButton>
      <Text slot="description" className="settings-help">Runs built-in AI actions, such as writing commit messages. Agent sessions are chosen when you start them.</Text>
      <Popover className="wb-popover">
        <ListBox items={agents}>
          {(agent) => <ListBoxItem id={agent.id} textValue={agent.label} isDisabled={!agent.available}>
            <div><span>{agent.label}</span>{!agent.available && <small>Not installed</small>}</div>
          </ListBoxItem>}
        </ListBox>
      </Popover>
    </Select>
    <p className="settings-help">Drafts and attachments stay on this computer. Attachments remain available to saved conversations while their view exists. CLI conversation storage is managed by the CLI.</p>
    <Button onPress={() => { void window.workbench.app.storageMaintenance(true).then((bytes) => setStorageNotice(`${Math.ceil(bytes / 1024 / 1024)} MB of attachments retained for open views.`)).catch(() => setStorageNotice("Could not clean attachment storage.")); }}>Remove attachments for closed views</Button>
    <Button onPress={() => { void window.workbench.app.revokeExecutionTrust().then(() => setStorageNotice("Workspace execution trust cleared. Running sessions keep their native permissions.")).catch(() => setStorageNotice("Could not clear execution trust.")); }}>Reset workspace execution trust</Button>
    {storageNotice && <p role="status" className="settings-help">{storageNotice}</p>}
    {services.widgets.forSlot("settings.general").map(({ id, component: Section }) => <Section key={id} />)}
  </div>;
}
