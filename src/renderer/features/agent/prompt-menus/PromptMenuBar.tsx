import { useEffect, useReducer, useState, type ReactNode } from "react";
import {
  Button as AriaButton,
  Checkbox,
  CheckboxGroup,
  Dialog,
  DialogTrigger,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  Modal,
  ModalOverlay,
  Popover,
  Select,
  SelectValue,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
} from "react-aria-components";
import {
  createEvaluator,
  resolveOptions,
  type PromptOptionDefinition,
  type PromptOptionEvaluator,
  type PromptOptionValue,
  type PromptSelections,
} from "../../../../shared/prompt-options";
import type { PromptMenuDefinition, PromptMenuOptions, PromptOptionTag } from "../../../core/prompt-menu-registry";
import { services } from "../../../core/services";
import { Button } from "../../../ui/controls";
import { CheckIcon, ChevronDownIcon } from "../../../ui/icons";
import { harnessOf, promptMenusFor, setPromptSelections, type ComposerTarget } from "../composer-state";
import { useContributions } from "../../../core/registry";
import type { PromptConditionContext } from "../../../../shared/prompt-options";

function groupByCategory(options: PromptOptionDefinition[]): [string, PromptOptionDefinition[]][] {
  const groups = new Map<string, PromptOptionDefinition[]>();
  for (const option of options) groups.set(option.category ?? "", [...(groups.get(option.category ?? "") ?? []), option]);
  return [...groups.entries()];
}

function OptionTag({ tag }: { tag?: PromptOptionTag }) {
  if (!tag) return null;
  const Icon = tag.icon;
  return <span className="prompt-option-tag" title={tag.label}><Icon size={11} /><span className="visually-hidden">{tag.label}</span></span>;
}

function OptionControl({ option, value, onChange, tag }: {
  option: PromptOptionDefinition;
  value: PromptOptionValue;
  onChange: (value: PromptOptionValue) => void;
  tag?: PromptOptionTag;
}) {
  const title: ReactNode = <span className="prompt-option-title"><span>{option.label}</span><OptionTag tag={tag} /></span>;
  switch (option.kind) {
    case "toggle":
      return <Switch className="prompt-option prompt-switch" isSelected={value === true} onChange={onChange}>
        <span className="prompt-option-copy">{title}{option.description && <small>{option.description}</small>}</span>
        <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>
      </Switch>;
    case "select": {
      const display = option.display ?? (option.choices.length <= 4 ? "segmented" : "dropdown");
      if (display === "list") {
        return <ListBox aria-label={option.label} className="prompt-choice-list" selectionMode="single" disallowEmptySelection
          selectedKeys={[String(value)]} onSelectionChange={(keys) => { if (keys !== "all" && keys.size) onChange(String([...keys][0])); }}>
          {option.choices.map((choice) => <ListBoxItem key={choice.id} id={choice.id} textValue={choice.label} className="prompt-choice">
            {({ isSelected }) => <>
              <span className="prompt-option-copy"><span>{choice.label}</span>{choice.description && <small>{choice.description}</small>}</span>
              {isSelected && <CheckIcon size={14} />}
            </>}
          </ListBoxItem>)}
        </ListBox>;
      }
      if (display === "segmented") {
        return <div className="prompt-option prompt-segmented-option">
          <span className="prompt-option-copy">{title}{option.description && <small>{option.description}</small>}</span>
          <ToggleButtonGroup aria-label={option.label} className="segmented" selectionMode="single" disallowEmptySelection
            selectedKeys={[String(value)]} onSelectionChange={(keys) => { if (keys.size) onChange(String([...keys][0])); }}>
            {option.choices.map((choice) => <ToggleButton key={choice.id} id={choice.id} className="segment">{choice.label}</ToggleButton>)}
          </ToggleButtonGroup>
        </div>;
      }
      return <Select className="prompt-option prompt-select" selectedKey={String(value)} onSelectionChange={(key) => onChange(String(key))}>
        <Label className="prompt-option-copy">{title}</Label>
        <AriaButton className="select-trigger"><SelectValue /><ChevronDownIcon size={13} /></AriaButton>
        <Popover className="wb-popover"><ListBox>{option.choices.map((choice) => <ListBoxItem key={choice.id} id={choice.id}>{choice.label}</ListBoxItem>)}</ListBox></Popover>
      </Select>;
    }
    case "multiSelect":
      return <CheckboxGroup className="prompt-option prompt-checkbox-group" value={Array.isArray(value) ? value : []} onChange={onChange}>
        <Label className="prompt-option-copy">{title}{option.description && <small>{option.description}</small>}</Label>
        <div className="prompt-checkboxes">{option.choices.map((choice) => <Checkbox key={choice.id} value={choice.id} className="wb-checkbox">
          <span className="checkbox-box"><CheckIcon size={11} /></span><span>{choice.label}</span>
        </Checkbox>)}</div>
      </CheckboxGroup>;
    case "text":
      return <TextField className="prompt-option prompt-text-option" value={typeof value === "string" ? value : ""} maxLength={option.maxLength} onChange={onChange}>
        <Label className="prompt-option-copy">{title}{option.description && <small>{option.description}</small>}</Label>
        <Input placeholder={option.placeholder} />
      </TextField>;
  }
}

function MenuOptions({ options, evaluator, onChange, tagOf }: {
  options: PromptOptionDefinition[];
  evaluator: PromptOptionEvaluator;
  onChange: (option: PromptOptionDefinition, value: PromptOptionValue) => void;
  tagOf: (optionId: string) => PromptOptionTag | undefined;
}) {
  const visible = options.filter((option) => evaluator.isVisible(option.id));
  if (!visible.length) return <p className="prompt-menu-empty">No options yet. Use Manage to add some.</p>;
  return <>{groupByCategory(visible).map(([category, items]) => <section className="prompt-menu-group" key={category || "default"} aria-label={category || undefined}>
    {category && <h4>{category}</h4>}
    {items.map((option) => <OptionControl key={option.id} option={option} value={evaluator.value(option)} onChange={(value) => onChange(option, value)} tag={tagOf(option.id)} />)}
  </section>)}</>;
}

function menuSummary(options: PromptOptionDefinition[], selections: PromptSelections, everyOption: PromptOptionDefinition[], conditions: PromptConditionContext): string | undefined {
  const resolved = resolveOptions(options, selections, everyOption, conditions);
  if (!resolved.length) return undefined;
  return options.length === 1 ? resolved[0].summary : String(resolved.length);
}

/** Re-renders when any menu says its options may have changed. */
function useMenuUpdates(workspaceId: string) {
  // Any registration change (a menu added, removed, or replaced under the same id by a reload) subscribes again.
  const revision = useContributions();
  const [, refresh] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    const unsubscribes = services.promptMenus.ordered(workspaceId).map((menu) => menu.subscribe?.(refresh));
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe?.());
  }, [revision, workspaceId]);
}

/** Renders every registered prompt menu as a composer button with an options popover. */
export function PromptMenuBar({ target, selections }: { target: ComposerTarget; selections: PromptSelections }) {
  useMenuUpdates(target.workspaceId);
  const [managing, setManaging] = useState<PromptMenuDefinition>();
  const menus: PromptMenuOptions[] = promptMenusFor(target);
  const everyOption = menus.flatMap((item) => item.options);
  const conditions = { providerId: harnessOf(target) };
  const evaluator = createEvaluator(everyOption, selections, conditions);
  const change = (option: PromptOptionDefinition, value: PromptOptionValue) => setPromptSelections(target, { ...selections, [option.id]: value });
  const Manager = managing?.manage?.component;

  return <div className="prompt-menu-bar">
    {menus.map(({ menu, options }) => {
      const Icon = menu.icon;
      const summary = menuSummary(options, selections, everyOption, conditions);
      return <DialogTrigger key={menu.id}>
        <AriaButton className={`composer-chip ${summary ? "is-active" : ""}`} aria-label={summary ? `${menu.label}: ${summary}` : menu.label}>
          <Icon size={14} /><span>{menu.label}</span>{summary && <span className="composer-chip-value">{summary}</span>}<ChevronDownIcon size={12} />
        </AriaButton>
        <Popover className="wb-popover prompt-menu-popover" placement="top start" offset={10}>
          <Dialog aria-label={menu.label} className="prompt-menu-dialog">
            {({ close }) => <>
              <header className="prompt-menu-header">
                <div><h3>{menu.label}</h3><p>{menu.description}</p></div>
                {menu.manage && <Button className="link-button" onPress={() => { close(); setManaging(menu); }}>Manage</Button>}
              </header>
              <div className="prompt-menu-body"><MenuOptions options={options} evaluator={evaluator} onChange={change} tagOf={(id) => menu.optionTag?.(id, target)} /></div>
            </>}
          </Dialog>
        </Popover>
      </DialogTrigger>;
    })}
    <ModalOverlay className="wb-modal-overlay" isDismissable isOpen={Boolean(managing)} onOpenChange={(open) => { if (!open) setManaging(undefined); }}>
      <Modal className="wb-modal">
        <Dialog aria-label={managing?.manage?.title} className="wb-dialog">
          <div className="dialog-header">
            <div><h2>{managing?.manage?.title}</h2><p>{managing?.manage?.description}</p></div>
            <Button onPress={() => setManaging(undefined)}>Done</Button>
          </div>
          {Manager && <Manager workspaceId={target.workspaceId} close={() => setManaging(undefined)} />}
        </Dialog>
      </Modal>
    </ModalOverlay>
  </div>;
}
