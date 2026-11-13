import { useState } from "react";
import { Form, Input, Label, Switch, TextField } from "react-aria-components";
import { useShallow } from "zustand/react/shallow";
import { APP_DIR, AGENT_GUIDE_FILE, EXTENSIONS_DIR } from "../../../shared/app-identity";
import { isFilesWorkspace } from "../../../shared/files-workspace";
import type { PanelProps } from "../../core/panel-registry";
import { useConfigLayers } from "../../core/config-layers";
import { errorMessage } from "../../core/errors";
import { services } from "../../core/services";
import { useActiveExtensions } from "../../extensions/host";
import {
  installedFor, reloadExtensions, setExtensionEnabled, trustWorkspaceExtensions, useInstalledExtensions, type InstalledExtension,
} from "../../extensions/workspace-extensions";
import { Button, IconButton } from "../../ui/controls";
import { PlusIcon, RefreshIcon } from "../../ui/icons";

const STATE_LABEL: Record<InstalledExtension["state"], string> = {
  "needs-trust": "Waiting for trust", disabled: "Off", loading: "Starting…", active: "Running", failed: "Failed",
};

function Row({ item, onToggle }: { item: InstalledExtension; onToggle: (on: boolean) => void }) {
  const title = useActiveExtensions((state) => state.records[item.key]?.title) ?? item.name;
  return <li className="extension-row">
    <div className="extension-row-copy">
      <span className="extension-row-title">{title}</span>
      <small className={`extension-state is-${item.state}`}>{STATE_LABEL[item.state]} · {item.entry}</small>
      {item.error && <pre className="extension-error-text" role="alert">{item.error}</pre>}
    </div>
    {item.state !== "needs-trust" && <Switch className="instruction-row-switch" aria-label={`${title} on`} isSelected={!item.disabled} onChange={onToggle}>
      <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>
    </Switch>}
  </li>;
}

/** A starter extension in this workspace, then an agent session ready to build on it. */
function NewExtension({ root, workspaceId, onDone }: { root: string; workspaceId: string; onDone: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const create = async () => {
    try {
      const { entry } = await window.workbench.extensions.scaffold(root, name.trim());
      await services.commands.execute("file.open", { workspaceId, root, path: entry, preview: false });
      onDone();
    } catch (failure) { setError(errorMessage(failure).replace(/^Error invoking remote method '[^']+': (Error: )?/, "")); }
  };
  return <Form className="extension-new" onSubmit={(event) => { event.preventDefault(); void create(); }}>
    <TextField value={name} onChange={(value) => { setName(value); setError(""); }} isRequired autoFocus>
      <Label>Folder name</Label><Input placeholder="e.g. level-editor" />
    </TextField>
    <p className="panel-empty">Creates {APP_DIR}/{EXTENSIONS_DIR}/{name.trim() || "<name>"}/index.tsx and {APP_DIR}/{AGENT_GUIDE_FILE}, a guide agents can read before building on it.</p>
    {error && <p className="agent-error" role="alert">{error}</p>}
    <div className="extension-new-actions"><Button onPress={onDone}>Cancel</Button><Button type="submit" className="primary-button" isDisabled={!name.trim()}>Create</Button></div>
  </Form>;
}

/** Every extension that applies to this workspace: its own (checked in), the person's own, and the built-in ones. */
export function ExtensionsPanel({ workspace }: PanelProps) {
  // Re-render as listings, running extensions and settings change.
  useInstalledExtensions();
  useActiveExtensions();
  useConfigLayers();
  const builtins = useActiveExtensions(useShallow((state) => Object.values(state.records).filter((record) => record.info.layer === "builtin")));
  const [creating, setCreating] = useState(false);
  const [problem, setProblem] = useState("");
  const folder = !isFilesWorkspace(workspace);
  const installed = installedFor(workspace);
  const own = installed.filter((item) => item.layer === "workspace");
  const user = installed.filter((item) => item.layer === "user");
  const waiting = own.filter((item) => item.state === "needs-trust");
  const toggle = (item: InstalledExtension, on: boolean) => void setExtensionEnabled(item, on).then((failure) => setProblem(failure ?? ""));

  return <div className="side-panel extensions-panel">
    <div className="side-panel-header">
      <h2>Extensions</h2>
      <div className="side-panel-actions">
        <IconButton label="Reload extensions" onPress={() => void reloadExtensions(workspace)}><RefreshIcon size={14} /></IconButton>
        {folder && <IconButton label="New workspace extension" onPress={() => setCreating(true)}><PlusIcon size={14} /></IconButton>}
      </div>
    </div>
    {problem && <p className="agent-error" role="alert">{problem}</p>}
    {creating && folder && <NewExtension root={workspace.path} workspaceId={workspace.id} onDone={() => setCreating(false)} />}
    {waiting.length > 0 && <div className="extension-trust" role="note">
      <p>{workspace.name} has {waiting.length === 1 ? "an extension" : `${waiting.length} extensions`} in {APP_DIR}/{EXTENSIONS_DIR}. Extensions run inside this app with the same access it has, so only trust workspaces you know.</p>
      <Button className="primary-button" onPress={() => void trustWorkspaceExtensions(workspace).catch((error: unknown) => setProblem(errorMessage(error).replace(/^Error invoking remote method '[^']+': (Error: )?/, "")))}>Trust workspace</Button>
    </div>}
    {folder && <section className="panel-section" aria-label={`In ${workspace.name}`}>
      <div className="panel-section-header"><span>In {workspace.name}</span><span className="count-badge">{own.length}</span></div>
      {own.length ? <ul className="extension-list">{own.map((item) => <Row key={item.key} item={item} onToggle={(on) => toggle(item, on)} />)}</ul>
        : <p className="panel-empty">Add a folder to {APP_DIR}/{EXTENSIONS_DIR} with an index.tsx to give this workspace its own views and panels.</p>}
    </section>}
    <section className="panel-section" aria-label="Yours, everywhere">
      <div className="panel-section-header"><span>Yours, everywhere</span><span className="count-badge">{user.length}</span></div>
      {user.length ? <ul className="extension-list">{user.map((item) => <Row key={item.key} item={item} onToggle={(on) => toggle(item, on)} />)}</ul>
        : <p className="panel-empty">Extensions in ~/{APP_DIR}/{EXTENSIONS_DIR} run in every workspace.</p>}
    </section>
    <section className="panel-section" aria-label="Built in">
      <div className="panel-section-header"><span>Built in</span><span className="count-badge">{builtins.length}</span></div>
      <ul className="extension-list">{builtins.map((record) => <li key={record.key} className="extension-row">
        <div className="extension-row-copy"><span className="extension-row-title">{record.title}</span><small>{record.description}</small></div>
      </li>)}</ul>
    </section>
  </div>;
}
