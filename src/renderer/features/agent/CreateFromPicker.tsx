import { useState } from "react";
import {
  Autocomplete,
  Button as AriaButton,
  Dialog,
  DialogTrigger,
  Header,
  Input,
  ListBox,
  ListBoxItem,
  ListBoxSection,
  Popover,
  SearchField,
} from "react-aria-components";
import type { BaseBranch, BaseBranches } from "../../../shared/models";
import { BranchIcon, CheckIcon, ChevronDownIcon, SearchIcon } from "../../ui/icons";

/** Rendering every branch of a large repository would make typing lag; a search reaches the rest. */
const SECTION_LIMIT = 100;

export type BaseChoice = Pick<BaseBranch, "ref" | "name">;

function age(updatedAt: number): string {
  const minutes = Math.max(1, Math.floor((Date.now() / 1000 - updatedAt) / 60));
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`;
  if (minutes < 60 * 24 * 30) return `${Math.floor(minutes / (60 * 24))}d`;
  if (minutes < 60 * 24 * 365) return `${Math.floor(minutes / (60 * 24 * 30))}mo`;
  return `${Math.floor(minutes / (60 * 24 * 365))}y`;
}

function Highlighted({ text, query }: { text: string; query: string }) {
  const start = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (start < 0) return <>{text}</>;
  return <>{text.slice(0, start)}<mark>{text.slice(start, start + query.length)}</mark>{text.slice(start + query.length)}</>;
}

function BranchOption({ branch, query, isDefault }: { branch: BaseBranch; query: string; isDefault: boolean }) {
  return <ListBoxItem id={branch.ref} textValue={branch.name} className="base-option">
    {({ isSelected }) => <>
      <span className="base-option-icon"><BranchIcon size={13} /></span>
      <span className="base-option-name"><Highlighted text={branch.name} query={query} /></span>
      {isDefault && <span className="base-tag">default</span>}
      {branch.current && <span className="base-tag">current</span>}
      {branch.updatedAt > 0 && <small title={new Date(branch.updatedAt * 1000).toLocaleString()}>{age(branch.updatedAt)}</small>}
      <span className="base-option-check" aria-hidden="true">{isSelected && <CheckIcon size={13} />}</span>
    </>}
  </ListBoxItem>;
}

function BranchSearch({ data, selected, refreshing, onSelect }: {
  data: BaseBranches;
  selected?: string;
  refreshing: boolean;
  onSelect: (branch?: BaseBranch) => void;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const matches = data.branches.filter((branch) => branch.name.toLowerCase().includes(needle));
  const defaultBranch = matches.find((branch) => branch.ref === data.defaultRef);
  const rest = matches.filter((branch) => branch !== defaultBranch);
  const remote = rest.filter((branch) => branch.kind === "remote");
  const local = rest.filter((branch) => branch.kind === "local");
  const hidden = Math.max(0, remote.length - SECTION_LIMIT) + Math.max(0, local.length - SECTION_LIMIT);
  const section = (title: string, branches: BaseBranch[]) => branches.length > 0 && <ListBoxSection className="base-section">
    <Header className="base-section-header">{title}</Header>
    {branches.slice(0, SECTION_LIMIT).map((branch) => <BranchOption key={branch.ref} branch={branch} query={needle} isDefault={false} />)}
  </ListBoxSection>;
  return <Autocomplete inputValue={query} onInputChange={setQuery}>
    <SearchField aria-label="Search branches" className="base-search" autoFocus>
      <SearchIcon size={13} />
      <Input placeholder="Search branches" />
    </SearchField>
    <ListBox aria-label="Branches" className="base-list" selectionMode="single" selectedKeys={selected ? [selected] : []}
      onSelectionChange={(keys) => {
        const ref = [...keys][0];
        // Choosing the selected row empties the selection: nothing changes and the picker closes.
        onSelect(ref === undefined ? undefined : data.branches.find((branch) => branch.ref === ref));
      }}
      renderEmptyState={() => <p className="base-empty">{data.branches.length ? `No branches match “${query.trim()}”` : "No branches yet"}</p>}>
      {defaultBranch && <ListBoxSection className="base-section"><BranchOption branch={defaultBranch} query={needle} isDefault /></ListBoxSection>}
      {section("Remote", remote)}
      {section("Local", local)}
    </ListBox>
    {(hidden > 0 || refreshing) && <div className="base-footer" role="status">
      {hidden > 0 && <span>{hidden} more — type to narrow</span>}
      {refreshing && <span className="base-footer-sync">Checking for new branches…</span>}
    </div>}
  </Autocomplete>;
}

/** Which branch a new worktree starts from. No `value` means the repository's default branch. */
export function CreateFromPicker({ data, error, refreshing, value, isDisabled, onOpen, onChange }: {
  data?: BaseBranches;
  error: string;
  refreshing: boolean;
  value?: BaseChoice;
  isDisabled?: boolean;
  onOpen: () => void;
  onChange: (value: BaseChoice | undefined) => void;
}) {
  const [isOpen, setOpen] = useState(false);
  const defaultBranch = data?.branches.find((branch) => branch.ref === data.defaultRef);
  const isDefault = !value || value.ref === data?.defaultRef;
  const label = value?.name ?? defaultBranch?.name ?? (data || error ? "Current commit" : "Finding branches…");
  const select = (branch?: BaseBranch) => {
    setOpen(false);
    if (branch) onChange(branch.ref === data?.defaultRef ? undefined : { ref: branch.ref, name: branch.name });
  };
  return <>
    <DialogTrigger isOpen={isOpen} onOpenChange={(open) => { setOpen(open); if (open) onOpen(); }}>
      <AriaButton className="select-trigger base-trigger" aria-label={`Create from: ${label}`} isDisabled={isDisabled || !data}>
        <span className="base-option-icon"><BranchIcon size={13} /></span>
        <span className="base-trigger-name">{label}</span>
        {defaultBranch && isDefault && <span className="base-tag">default</span>}
        <span className="base-trigger-chevron"><ChevronDownIcon size={13} /></span>
      </AriaButton>
      <Popover className="wb-popover base-popover" placement="bottom start" offset={6}>
        <Dialog aria-label="Create from" className="base-dialog">
          {data && <BranchSearch data={data} selected={value?.ref ?? data.defaultRef} refreshing={refreshing} onSelect={select} />}
        </Dialog>
      </Popover>
    </DialogTrigger>
    {error && <p role="alert" className="launcher-field-error">Couldn’t list branches: {error}</p>}
  </>;
}
