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
import { REPO_INSTRUCTIONS_PATH, layerInstructions, type InstructionLayer, type LayeredInstruction } from "../../../shared/instruction-layers";
import { choice, select, textInput, toggle, type PromptOptionChoice, type PromptOptionDefinition } from "../../../shared/prompt-options";
import { createId } from "../../core/id";
import { services } from "../../core/services";
import { useWorkbenchStore } from "../../state/workbench-store";
import { useChoiceDialog } from "../../ui/ChoiceDialog";
import { CheckIcon, ChevronDownIcon, PlusIcon, TrashIcon } from "../../ui/icons";
import { Button, IconButton } from "../../ui/controls";
import { layerCopy } from "./layer-copy";
import { saveRepoInstructions, useRepoInstructions, type RepoInstructions } from "./repo-instructions";

type Kind = "toggle" | "select" | "text";

function Picker<T extends string>({ label, value, onChange, items }: { label: string; value: T; onChange: (value: T) => void; items: [T, string][] }) {
  return <Select selectedKey={value} onSelectionChange={(key) => onChange(key as T)}>
    <Label>{label}</Label>
    <AriaButton className="select-trigger"><SelectValue /><ChevronDownIcon size={14} /></AriaButton>
    <Popover className="wb-popover"><ListBox>{items.map(([id, text]) => <ListBoxItem key={id} id={id}>{text}</ListBoxItem>)}</ListBox></Popover>
  </Select>;
}

const LAYERS: InstructionLayer[] = ["global", "shared", "personal"];
const LOADING: RepoInstructions = { status: "loading" };

/** What saving in a layer does, in one sentence. */
function consequence(layer: InstructionLayer, repo: string): string {
  switch (layer) {
    case "global": return "Saved in your Workbench settings and offered in every repo. You can still turn it off for one repo.";
    case "shared": return `Saved to ${REPO_INSTRUCTIONS_PATH} in ${repo}. Commit it to share it with everyone who works there.`;
    case "personal": return `Saved in your Workbench settings for ${repo} only. Never written to the repo.`;
  }
}

function InstructionForm({ option, layer: initialLayer, repo, sharedAvailable, onSave }: {
  option?: PromptOptionDefinition;
  layer: InstructionLayer;
  repo: string;
  sharedAvailable: boolean;
  onSave: (layer: InstructionLayer, option: PromptOptionDefinition) => Promise<string | undefined>;
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
    void onSave(layer, built).then((failure) => { setSaving(false); if (failure) setError(failure); });
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
  const [stored, workspace] = useWorkbenchStore(useShallow((state) => [state.instructionOptions, state.workspaces.find((w) => w.id === workspaceId)]));
  const upsert = useWorkbenchStore((state) => state.upsertInstructionOption);
  const remove = useWorkbenchStore((state) => state.deleteInstructionOption);
  const setDisabled = useWorkbenchStore((state) => state.setInstructionDisabled);
  const restoreDefaults = useWorkbenchStore((state) => state.restoreDefaultInstructions);
  const root = workspace?.path ?? "";
  const repoFile = useRepoInstructions((state) => state[root] ?? LOADING);
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

  const writeLayer = async (layer: InstructionLayer, option: PromptOptionDefinition): Promise<string | undefined> => {
    if (layer === "shared") {
      return saveRepoInstructions(root, (options) => options.some((item) => item.id === option.id)
        ? options.map((item) => (item.id === option.id ? option : item))
        : [...options, option]);
    }
    upsert({ scope: layer === "global" ? "global" : "workspace", workspaceId: layer === "personal" ? workspaceId : undefined, option });
    return undefined;
  };

  const save = async (layer: InstructionLayer, option: PromptOptionDefinition): Promise<string | undefined> => {
    const failure = await writeLayer(layer, option);
    if (failure) return failure;
    // A move: the new copy is saved, so take it out of the old place. Stored-to-stored moves replace in place.
    if (current && current.layer !== layer) {
      if (current.layer === "shared") {
        const removed = await saveRepoInstructions(root, (options) => options.filter((item) => item.id !== option.id));
        if (removed) return `Saved, but it is still in ${REPO_INSTRUCTIONS_PATH}: ${removed}`;
      } else if (layer === "shared") remove(option.id);
    }
    setEditing({ layer, id: option.id });
    return undefined;
  };

  const deleteCurrent = async () => {
    if (!current) return;
    if (current.layer === "shared") {
      const answer = await choose(`Delete “${current.option.label}”?`,
        `It is removed from ${REPO_INSTRUCTIONS_PATH}, so everyone in ${repo} loses it once the change is committed.`, ["Cancel", "Delete"]);
      if (answer !== "Delete") return;
      const failure = await saveRepoInstructions(root, (options) => options.filter((item) => item.id !== current.option.id));
      if (failure) { await choose("Couldn't delete the instruction", failure, ["OK"]); return; }
    } else remove(current.option.id);
    setEditing({ layer: current.layer });
  };

  const revealFile = () => {
    close?.();
    void services.commands.execute("file.open", { workspaceId, root, path: REPO_INSTRUCTIONS_PATH, preview: false });
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
              Couldn’t read {REPO_INSTRUCTIONS_PATH}: {repoFile.error}. Fix the file to edit shared instructions.
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
              <Button className="link-button instruction-file-link" onPress={revealFile}>Open {REPO_INSTRUCTIONS_PATH}</Button>}
            {layer === "global" && missingDefaults.length > 0 &&
              <Button className="link-button instruction-file-link" onPress={() => restoreDefaults(missingDefaults.map((option) => option.id))}>Restore {plural(missingDefaults.length, "default instruction")}</Button>}
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
          ? <p className="empty-copy">Fix {REPO_INSTRUCTIONS_PATH} to edit shared instructions.</p>
          : <InstructionForm key={`${editing.layer}:${editing.id ?? "new"}`} option={current?.option} layer={editing.layer} repo={repo}
            sharedAvailable={sharedAvailable} onSave={save} />}
      </div>
    </div>
    {dialog}
  </div>;
}
