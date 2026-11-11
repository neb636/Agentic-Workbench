import { Button as AriaButton, Label, ListBox, ListBoxItem, Popover, Select, SelectValue, Text } from "react-aria-components";
import { services } from "../../core/services";
import { useWorkbenchStore } from "../../state/workbench-store";
import { ChevronDownIcon } from "../../ui/icons";
import { useDefaultCli } from "./default-cli";

export function GeneralSettings() {
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
    {services.widgets.forSlot("settings.general").map(({ id, component: Section }) => <Section key={id} />)}
  </div>;
}
