import { useState } from "react";
import {
  Button as AriaButton,
  Checkbox,
  GridList,
  GridListItem,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  Select,
  SelectValue,
  Switch,
  TextArea,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
} from "react-aria-components";
import { useShallow } from "zustand/react/shallow";
import { defaultInstructions } from "../../../shared/default-instructions";
import { INSTRUCTION_FILES, LEGACY_REPO_INSTRUCTIONS_PATH, layerInstructions, type InstructionLayer, type LayeredInstruction } from "../../../shared/instruction-layers";
import { choice, select, textInput, toggle, type PromptOptionChoice, type PromptOptionDefinition } from "../../../shared/prompt-options";
import { createId } from "../../core/id";
import { services } from "../../core/services";
import { useWorkbenchStore } from "../../state/workbench-store";
import { useChoiceDialog } from "../../ui/ChoiceDialog";
import { CheckIcon, ChevronDownIcon, PlusIcon, TrashIcon } from "../../ui/icons";
import { Button, IconButton } from "../../ui/controls";
import { layerCopy } from "./layer-copy";
import { fileHolds, saveInstructions, storedOptionsOf, useInstructionFiles } from "./repo-instructions";

type Kind = "toggle" | "select" | "text";

function Picker<T extends string>({ label, value, onChange, items }: { label: string; value: T; onChange: (value: T) => void; items: [T, string][] }) {
  return <Select selectedKey={value} onSelectionChange={(key) => onChange(key as T)}>
    <Label>{label}</Label>
    <AriaButton className="select-trigger"><SelectValue /><ChevronDownIcon size={14} /></AriaButton>
    <Popover className="wb-popover"><ListBox>{items.map(([id, text]) => <ListBoxItem key={id} id={id}>{text}</ListBoxItem>)}</ListBox></Popover>
  </Select>;
}

const LAYERS: InstructionLayer[] = ["global", "shared", "personal"];

/** What saving in a layer does, in one sentence. */
function consequence(layer: InstructionLayer, repo: string): string {
  switch (layer) {
    case "global": return `Saved to ${INSTRUCTION_FILES.global} and offered in every repo. You can still turn it off for one repo.`;
    case "shared": return `Saved to ${INSTRUCTION_FILES.shared} in ${repo}. Commit it to share it with everyone who works there.`;
    case "personal": return `Saved to ${INSTRUCTION_FILES.personal} in ${repo}, for you only. It is ignored by version control, never shared.`;
  }
}

function InstructionForm({ option, layer: initialLayer, repo, sharedAvailable, onSave }: {
  option?: PromptOptionDefinition;
  layer: InstructionLayer;
  repo: string;
  sharedAvailable: boolean;
  /** `original` is the instruction as it was when editing began, to detect changes made meanwhile. */
  onSave: (layer: InstructionLayer, option: PromptOptionDefinition, original?: PromptOptionDefinition) => Promise<string | undefined>;
}) {
  const [kind, setKind] = useState<Kind>(option?.kind === "multiSelect" ? "select" : option?.kind ?? "toggle");
  const [label, setLabel] = useState(option?.label ?? "");
  const [category, setCategory] = useState(option?.category ?? "Custom");
  const [description, setDescription] = useState(option?.description ?? "");
  const [text, setText] = useState(option?.kind === "toggle" ? option.text : option?.kind === "text" ? option.template : "");
  const [defaultOn, setDefaultOn] = useState(option?.kind === "toggle" ? option.defaultOn : false);
  const [choices, setChoices] = useState<PromptOptionChoice[]>(option?.kind === "select" ? option.choices : [choice("none", "None"), choice(createId("choice"), "")]);
  const [defaultChoice, setDefaultChoice] = useState(option?.kind === "select" ? option.defaultChoice : "none");
  const [display, setDisplay] = useState<"segmented" | "dropdown" | "list">(option?.display ?? "segmented");
  const [placeholder, setPlaceholder] = useState(option?.kind === "text" ? option.placeholder : "");
  const [resetAfterSend, setResetAfterSend] = useState(option?.resetAfterSend ?? false);
  const [layer, setLayer] = useState<InstructionLayer>(initialLayer);
  // The fields above hold this version; `option` itself follows the file if someone else changes it meanwhile.
  const [original] = useState(option);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const build = (): PromptOptionDefinition | string => {
    const id = option?.id ?? createId("instruction");
    // Keep fields the form doesn't edit, such as a condition on another option.
    const fields = { label: label.trim(), category: category.trim() || undefined, description: description.trim() || undefined, resetAfterSend, when: option?.when };
    if (!fields.label) return "Give the instruction a label.";
    if (kind === "toggle") return text.trim() ? toggle(id, { ...fields, text: text.trim(), defaultOn }) : "Add the text this instruction appends.";
    if (kind === "text") return text.includes("{{value}}")
      ? textInput(id, { ...fields, template: text.trim(), placeholder, maxLength: option?.kind === "text" ? option.maxLength : undefined })
      : "The template must include {{value}}.";
    const named = choices.filter((item) => item.label.trim()).map((item) => ({ ...item, label: item.label.trim(), text: item.text.trim() }));
    if (named.length < 2) return "Add at least two named choices.";
    return select(id, { ...fields, display, choices: named, default: named.some((item) => item.id === defaultChoice) ? defaultChoice : named[0].id });
  };

  return <form className="persona-form instruction-form" onSubmit={(event) => {
    event.preventDefault();
    const built = build();
    if (typeof built === "string") { setError(built); return; }
    setError("");
    setSaving(true);
    void onSave(layer, built, original).then((failure) => { setSaving(false); if (failure) setError(failure); });
  }}>
    <div className="instruction-audience">
      <span className="instruction-audience-label" id="instruction-audience-label">Who gets it</span>
      <ToggleButtonGroup aria-labelledby="instruction-audience-label" className="segmented instruction-audience-segments" selectionMode="single" disallowEmptySelection
        selectedKeys={[layer]} onSelectionChange={(keys) => { const next = [...keys][0]; if (next) setLayer(next as InstructionLayer); }}>
        {LAYERS.map((id) => {
          const Icon = layerCopy[id].icon;
          return <ToggleButton key={id} id={id} className="segment" isDisabled={id === "shared" && !sharedAvailable && layer !== "shared"}>
            <Icon size={13} />{id === "global" ? "Everywhere" : id === "shared" ? "Shared in repo" : "Only me here"}
          </ToggleButton>;
        })}
      </ToggleButtonGroup>
      <p className="instruction-consequence">
        {consequence(layer, repo)}
        {option && layer !== initialLayer && ` Saving moves it out of ${layerCopy[initialLayer].title(repo)}.`}
      </p>
    </div>
    <div className="form-row">
      <Picker label="Kind" value={kind} onChange={setKind} items={[["toggle", "Toggle"], ["select", "Choice"], ["text", "Text input"]]} />
      <TextField value={category} onChange={setCategory}><Label>Category</Label><Input placeholder="Shown as a heading" /></TextField>
    </div>
    <TextField value={label} onChange={setLabel} isRequired><Label>Label</Label><Input placeholder="e.g. Update the changelog" autoFocus /></TextField>
    <TextField value={description} onChange={setDescription}><Label>Description</Label><Input placeholder="Optional hint shown under the label" /></TextField>
    {kind === "toggle" && <>
      <TextField value={text} onChange={setText} isRequired><Label>Appended text</Label><TextArea rows={4} placeholder="Also update CHANGELOG.md with a short entry." /></TextField>
      <Checkbox className="wb-checkbox" isSelected={defaultOn} onChange={setDefaultOn}><span className="checkbox-box"><CheckIcon size={11} /></span><span>On by default</span></Checkbox>
    </>}
    {kind === "text" && <>
      <TextField value={text} onChange={setText} isRequired><Label>Template</Label><TextArea rows={3} placeholder="Request review from {{value}}." /></TextField>
      <TextField value={placeholder} onChange={setPlaceholder}><Label>Placeholder</Label><Input /></TextField>
    </>}
    {kind === "select" && <fieldset className="choice-editor">
      <legend>Choices</legend>
      {choices.map((item, index) => <div className="choice-row" key={item.id}>
        <TextField aria-label={`Choice ${index + 1} label`} value={item.label} onChange={(value) => setChoices(choices.map((c) => c.id === item.id ? { ...c, label: value } : c))}><Input placeholder="Label" /></TextField>
        <TextField aria-label={`Choice ${index + 1} text`} value={item.text} onChange={(value) => setChoices(choices.map((c) => c.id === item.id ? { ...c, text: value } : c))}><Input placeholder="Appended text (empty adds nothing)" /></TextField>
        <IconButton label={`Remove choice ${index + 1}`} onPress={() => setChoices(choices.filter((c) => c.id !== item.id))}><TrashIcon size={13} /></IconButton>
      </div>)}
      <Button onPress={() => setChoices([...choices, choice(createId("choice"), "")])}><PlusIcon size={13} />Add choice</Button>
      <div className="form-row">
        <Picker label="Default" value={defaultChoice} onChange={setDefaultChoice} items={choices.filter((c) => c.label.trim()).map((c) => [c.id, c.label])} />
        <Picker label="Display" value={display} onChange={setDisplay} items={[["segmented", "Segmented"], ["dropdown", "Dropdown"], ["list", "List"]]} />
      </div>
    </fieldset>}
    <Checkbox className="wb-checkbox" isSelected={resetAfterSend} onChange={setResetAfterSend}><span className="checkbox-box"><CheckIcon size={11} /></span><span>Reset after each send</span></Checkbox>
    {error && <p role="alert" className="agent-error">{error}</p>}
    <Button type="submit" className="primary-button" isDisabled={saving}>{option ? "Save instruction" : "Add instruction"}</Button>
  </form>;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** One sentence that shows what the composer offers in this repo and where it comes from. */
function summaryOf(layered: LayeredInstruction[], repo: string): string {
  const on = (layer: InstructionLayer) => layered.filter((item) => item.layer === layer && !item.disabled && !item.replaced).length;
  const off = layered.filter((item) => item.layer !== "personal" && item.disabled && !item.replaced).length;
  const total = on("global") + on("shared") + on("personal");
  const parts = [
    `${on("global")} everywhere`,
    ...(on("shared") ? [`${on("shared")} shared`] : []),
    ...(on("personal") ? [`${on("personal")} only yours`] : []),
  ];
  return `In ${repo}, the composer offers ${plural(total, "instruction")}: ${parts.join(", ")}${off ? `. ${off} turned off here` : ""}.`;
}

function rowStatus(item: LayeredInstruction, repo: string): string | undefined {
  if (item.replaced) return `Replaced here by the shared version`;
  if (item.disabled) return `Off in ${repo}`;
  return undefined;
}

type Editing = { layer: InstructionLayer; id?: string };

export function InstructionsManager({ workspaceId, close }: { workspaceId: string; close?: () => void }) {
  const [workspace] = useWorkbenchStore(useShallow((state) => [state.workspaces.find((w) => w.id === workspaceId)]));
  const forgetSettings = useWorkbenchStore((state) => state.forgetInstructionSettings);
  const setDisabled = useWorkbenchStore((state) => state.setInstructionDisabled);
  const dropStored = useWorkbenchStore((state) => state.dropStoredInstruction);
  const retained = useWorkbenchStore((state) => state.instructionOptions);
  const root = workspace?.path ?? "";
  const files = useInstructionFiles(root || undefined);
  const repoFile = files.shared;
  const stored = storedOptionsOf(files, workspaceId, retained);
  // Until its first save in `.dimsum/`, a workspace's shared instructions still come from the old file.
  const sharedPath = files.legacyShared ? LEGACY_REPO_INSTRUCTIONS_PATH : INSTRUCTION_FILES.shared;
  const repo = workspace?.name ?? "this repo";
  const layered = layerInstructions({
    stored,
    shared: repoFile.status === "ok" ? repoFile.options : [],
    workspaceId,
    disabledIds: workspace?.disabledInstructionIds ?? [],
  });
  const [editing, setEditing] = useState<Editing>(() => (layered[0] ? { layer: layered[0].layer, id: layered[0].option.id } : { layer: "global" }));
  const current = editing.id ? layered.find((item) => item.layer === editing.layer && item.option.id === editing.id) : undefined;
  // A default moved into this repo's shared file isn't missing here.
  const missingDefaults = defaultInstructions.filter((option) => !layered.some((item) => item.option.id === option.id));
  const sharedAvailable = repoFile.status === "ok" || repoFile.status === "missing";
  const { choose, dialog } = useChoiceDialog();
  // An instruction that is still only in the saved state (its file couldn't take it yet) is changed there, not in a file.
  const retainedOnly = (item: typeof current): item is NonNullable<typeof current> & { layer: "global" | "personal" } =>
    Boolean(item && item.layer !== "shared" && !fileHolds(files, item.layer, item.option.id));

  const writeLayer = (layer: InstructionLayer, option: PromptOptionDefinition): Promise<string | undefined> =>
    saveInstructions(layer, root, (options) => options.some((item) => item.id === option.id)
      ? options.map((item) => (item.id === option.id ? option : item))
      : [...options, option]);

  const save = async (layer: InstructionLayer, edited: PromptOptionDefinition, original?: PromptOptionDefinition): Promise<string | undefined> => {
    const moving = Boolean(current && current.layer !== layer);
    if (original && !current) return "This instruction was removed while you were editing, so your edits weren't saved.";
    // Another writer (an agent, an editor, a teammate's pull) changed this shared instruction while the form was open.
    if (current?.layer === "shared" && original && JSON.stringify(current.option) !== JSON.stringify(original)) {
      return `This instruction changed in ${sharedPath} while you were editing, so your edits weren't saved. Select it again to see the new version.`;
    }
    // Moving onto an id the destination already holds (a shared instruction replacing a stored one, or the reverse)
    // would overwrite that other copy, so the moved one gets a new id instead.
    const sharedIds = new Set(layered.filter((item) => item.layer === "shared").map((item) => item.option.id));
    const taken = moving && (layer === "shared" ? sharedIds.has(edited.id) : current?.layer === "shared" && stored.some((item) => item.option.id === edited.id));
    const option = taken ? { ...edited, id: createId("instruction") } : edited;
    const failure = await writeLayer(layer, option);
    if (failure) return failure;
    // Saved to a file: a copy kept only in the saved state is no longer needed.
    if (retainedOnly(current)) dropStored(current.layer, workspaceId, current.option.id);
    // A move: the new copy is saved, so take it out of the old place.
    if (current && moving) {
      if (!retainedOnly(current)) {
        const removed = await saveInstructions(current.layer, root, (options) => options.filter((item) => item.id !== current.option.id));
        if (removed) return `Saved, but it is still in ${current.layer === "shared" ? sharedPath : INSTRUCTION_FILES[current.layer]}: ${removed}`;
      }
      // With the same id in the new place, where it was turned off still applies.
      if (taken) forgetSettings(current.option.id);
    }
    setEditing({ layer, id: option.id });
    return undefined;
  };

  const deleteCurrent = async () => {
    if (!current) return;
    if (current.layer === "shared") {
      const answer = await choose(`Delete “${current.option.label}”?`,
        `It is removed from ${sharedPath}, so everyone in ${repo} loses it once the change is committed.`, ["Cancel", "Delete"]);
      if (answer !== "Delete") return;
    }
    if (retainedOnly(current)) dropStored(current.layer, workspaceId, current.option.id);
    else {
      const failure = await saveInstructions(current.layer, root, (options) => options.filter((item) => item.id !== current.option.id));
      if (failure) { await choose("Couldn't delete the instruction", failure, ["OK"]); return; }
    }
    if (current.layer !== "shared") forgetSettings(current.option.id);
    setEditing({ layer: current.layer });
  };

  const revealFile = () => {
    close?.();
    void services.commands.execute("file.open", { workspaceId, root, path: sharedPath, preview: false });
  };
  const restoreDefaults = async (ids: string[]) => {
    const failure = await saveInstructions("global", root, (options) => [
      ...defaultInstructions.filter((option) => ids.includes(option.id) && !options.some((item) => item.id === option.id)), ...options]);
    if (failure) await choose("Couldn't restore the defaults", failure, ["OK"]);
  };

  return <div className="instructions-manager">
    <p className="instructions-summary">{summaryOf(layered, repo)}</p>
    <div className="persona-manager">
      <div className="persona-list-pane instruction-layers">
        {LAYERS.map((layer) => {
          const copy = layerCopy[layer];
          const Icon = copy.icon;
          const items = layered.filter((item) => item.layer === layer);
          const title = copy.title(repo);
          return <section key={layer} className={`instruction-layer is-${layer}`} aria-label={title}>
            <header className="instruction-layer-header">
              <span className="instruction-layer-icon"><Icon size={14} /></span>
              <div className="instruction-layer-copy"><h3>{title}</h3><p>{copy.hint}</p></div>
              <IconButton label={`Add to ${title}`} isDisabled={layer === "shared" && !sharedAvailable} onPress={() => setEditing({ layer })}><PlusIcon size={14} /></IconButton>
            </header>
            {layer === "shared" && repoFile.status === "invalid" && <p role="alert" className="instruction-file-error">
              Couldn’t read {sharedPath}: {repoFile.error}. Fix the file to edit shared instructions.
            </p>}
            {layer !== "shared" && files[layer].status === "invalid" && <p role="alert" className="instruction-file-error">
              Couldn’t read {INSTRUCTION_FILES[layer]}: {(files[layer] as { error: string }).error}. Fix the file to change these.
            </p>}
            {layer !== "personal" && items.some((item) => !item.replaced) &&
              <span className="instruction-list-caption" aria-hidden="true">On here</span>}
            <GridList aria-label={title} className="instruction-list" items={items.map((item) => ({ ...item, id: item.option.id }))}
              selectionMode="single" selectionBehavior="replace" disallowEmptySelection
              selectedKeys={editing.layer === layer && editing.id ? [editing.id] : []}
              onSelectionChange={(keys) => { if (keys !== "all" && keys.size) setEditing({ layer, id: String([...keys][0]) }); }}
              renderEmptyState={() => <p className="empty-copy">{layer === "global"
                ? "Add one, or restore the defaults below."
                : layer === "shared"
                  ? (repoFile.status === "loading" ? "Loading…" : repoFile.status === "invalid" ? "" : `Add one to share it with everyone who works in ${repo}.`)
                  : "Add one that only you get in this repo."}</p>}>
              {(item) => {
                const status = rowStatus(item, repo);
                return <GridListItem id={item.id} textValue={item.option.label}
                  className={`persona-list-item instruction-row ${item.disabled || item.replaced ? "is-off" : ""}`}>
                  <span className="instruction-row-copy">
                    <span>{item.option.label}</span>
                    <small>{status ?? item.option.category ?? "Uncategorized"}</small>
                  </span>
                  {layer !== "personal" && !item.replaced && <Switch className="instruction-row-switch" aria-label={`On in ${repo}`}
                    isSelected={!item.disabled} onChange={(on) => setDisabled(workspaceId, item.option.id, !on)}>
                    <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>
                  </Switch>}
                </GridListItem>;
              }}
            </GridList>
            {layer === "shared" && repoFile.status !== "missing" && repoFile.status !== "loading" &&
              <Button className="link-button instruction-file-link" onPress={revealFile}>Open {sharedPath}</Button>}
            {layer === "global" && missingDefaults.length > 0 &&
              <Button className="link-button instruction-file-link" onPress={() => void restoreDefaults(missingDefaults.map((option) => option.id))}>Restore {plural(missingDefaults.length, "default instruction")}</Button>}
          </section>;
        })}
      </div>
      <div className="persona-editor-pane">
        <div className="dialog-section-header">
          <span>{current ? "Edit instruction" : `New instruction · ${layerCopy[editing.layer].title(repo)}`}</span>
          {current && <IconButton label="Delete instruction" isDisabled={current.layer === "shared" && !sharedAvailable} onPress={() => void deleteCurrent()}><TrashIcon size={15} /></IconButton>}
        </div>
        {current?.replaced && <p className="instruction-consequence">{repo} shares an instruction with the same id, so the shared version is used here. Your copy still applies in other repos.</p>}
        {current?.layer === "shared" && !sharedAvailable
          ? <p className="empty-copy">Fix {sharedPath} to edit shared instructions.</p>
          : <InstructionForm key={`${editing.layer}:${editing.id ?? "new"}`} option={current?.option} layer={editing.layer} repo={repo}
            sharedAvailable={sharedAvailable} onSave={save} />}
      </div>
    </div>
    {dialog}
  </div>;
}
