import { useEffect, useState } from "react";
import { Button as AriaButton, Dialog, Heading, Input, Label, ListBox, ListBoxItem, Modal, ModalOverlay, Popover, Select, SelectValue, TextField } from "react-aria-components";
import type { BaseBranch, SourceControlAction, SourceControlBranchAction, SourceControlStatus } from "../../../shared/models";
import { useContextMenu, type ContextAction } from "../../ui/ContextMenu";
import { Button, IconButton } from "../../ui/controls";
import { ArrowDownIcon, ArrowUpIcon, BranchIcon, ChevronDownIcon, CloudDownIcon } from "../../ui/icons";
import { ACTIONS, confirmAndRunAction, isEnabled, runAction } from "./source-control-actions";
import { runSourceControlTask, useSourceControlActivity } from "./source-control-store";

const MENU_SECTIONS: { section: string; actions: SourceControlAction[] }[] = [
  { section: "sync", actions: ["sync", "pull", "pullRebase", "push", "fetch", "fetchPrune"] },
  { section: "changes", actions: ["stageAll", "unstageAll", "discardAll"] },
  { section: "commit", actions: ["undoLastCommit"] },
  { section: "stash", actions: ["stash", "stashIncludeUntracked"] },
];

const BRANCH_ACTIONS: Record<SourceControlBranchAction, { label: string; title: string; confirm: string; running: string }> = {
  create: { label: "Create Branch…", title: "Create a branch", confirm: "Create", running: "Creating the branch…" },
  merge: { label: "Merge Branch…", title: "Merge a branch into this one", confirm: "Merge", running: "Merging…" },
  rebase: { label: "Rebase Onto Branch…", title: "Rebase this branch onto another", confirm: "Rebase", running: "Rebasing…" },
  delete: { label: "Delete Branch…", title: "Delete a local branch", confirm: "Delete", running: "Deleting the branch…" },
};

/** The everyday actions, one press away. */
export function SourceControlToolbar({ root, status }: { root: string; status: SourceControlStatus }) {
  const busy = useSourceControlActivity((state) => Boolean(state[root]?.running));
  const button = (action: SourceControlAction, label: string, icon: React.ReactNode) => status.actions.includes(action)
    ? <IconButton label={label} isDisabled={busy || !isEnabled(status, action)} onPress={() => void runAction(root, action)}>{icon}</IconButton> : null;
  return <>
    {button("pull", status.behind ? `Pull ${status.behind} from ${status.upstream ?? "remote"}` : "Pull", <ArrowDownIcon size={14} />)}
    {button("push", !status.upstream ? "Publish branch" : status.ahead ? `Push ${status.ahead} to ${status.upstream}` : "Push", <ArrowUpIcon size={14} />)}
    {button("fetch", "Fetch", <CloudDownIcon size={14} />)}
  </>;
}

/** Everything else the provider supports. */
export function SourceControlMoreMenu({ root, status }: { root: string; status: SourceControlStatus }) {
  const menu = useContextMenu("Source control");
  const busy = useSourceControlActivity((state) => Boolean(state[root]?.running));
  const [branchAction, setBranchAction] = useState<SourceControlBranchAction>();
  const actions: ContextAction[] = MENU_SECTIONS.flatMap(({ section, actions: ids }) => ids.filter((id) => status.actions.includes(id)).map((id) => ({
    id, section, label: id === "push" && !status.upstream ? "Publish Branch" : ACTIONS[id].label, destructive: id === "discardAll",
    disabled: busy || !isEnabled(status, id), run: () => confirmAndRunAction(root, status, id),
  })));
  if (status.features.includes("branches")) {
    for (const id of ["create", "merge", "rebase", "delete"] as const) {
      actions.push({ id: `branch-${id}`, section: "branch", label: BRANCH_ACTIONS[id].label, disabled: busy || (id !== "create" && !status.head), run: () => setBranchAction(id) });
    }
  }
  if (!actions.length) return null;
  return <>
    {menu.overlay}
    {menu.overflow(actions, "More source control", "wb-icon-button")}
    {branchAction && <BranchDialog root={root} status={status} action={branchAction} onClose={() => setBranchAction(undefined)} />}
  </>;
}

/** Names a new branch, or picks an existing one to merge, rebase onto or delete. */
function BranchDialog({ root, status, action, onClose }: { root: string; status: SourceControlStatus; action: SourceControlBranchAction; onClose: () => void }) {
  const copy = BRANCH_ACTIONS[action];
  const creating = action === "create";
  const [branches, setBranches] = useState<BaseBranch[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState("");
  useEffect(() => {
    if (creating) return;
    let active = true;
    window.workbench.sourceControl.baseBranches(root).then((result) => { if (active) setBranches(result.branches); }).catch(() => undefined);
    return () => { active = false; };
  }, [root, creating]);
  const options = branches.filter((branch) => action === "delete" ? branch.kind === "local" && !branch.current : branch.name !== status.branch);
  const target = creating ? name.trim() : selected;
  const submit = () => {
    if (!target) return;
    onClose();
    void runSourceControlTask(root, copy.running, () => window.workbench.sourceControl.branchAction(root, action, target));
  };
  return <ModalOverlay className="wb-modal-overlay" isDismissable isOpen onOpenChange={(open) => { if (!open) onClose(); }}>
    <Modal className="wb-modal wb-alert">
      <Dialog className="wb-dialog">
        <Heading slot="title">{copy.title}</Heading>
        {creating
          ? <TextField value={name} onChange={setName} className="branch-field" autoFocus>
            <Label>Branch name</Label>
            <Input placeholder="feature/name" />
          </TextField>
          : <Select className="branch-select" placeholder="Choose a branch…" selectedKey={selected} onSelectionChange={(key) => setSelected(key === null ? null : String(key))}>
            <Label>Branch</Label>
            <AriaButton className="select-trigger" isDisabled={!options.length}><SelectValue /><ChevronDownIcon size={14} /></AriaButton>
            <Popover className="wb-popover branch-popover">
              <ListBox items={options.map((branch) => ({ id: branch.ref, name: branch.name }))}>{(item) => <ListBoxItem id={item.id} textValue={item.name}><BranchIcon size={12} /> {item.name}</ListBoxItem>}</ListBox>
            </Popover>
          </Select>}
        {action === "delete" && <p className="panel-note">A branch with commits that aren't merged anywhere is refused rather than deleted.</p>}
        <div className="dialog-actions"><Button onPress={onClose}>Cancel</Button><Button className="primary-button" isDisabled={!target} onPress={submit}>{copy.confirm}</Button></div>
      </Dialog>
    </Modal>
  </ModalOverlay>;
}
