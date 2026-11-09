import { useRef, useState, type DragEvent } from "react";
import {
  Button as AriaButton,
  Dialog,
  DialogTrigger,
  FileTrigger,
  ListBox,
  ListBoxItem,
  Modal,
  ModalOverlay,
  Popover,
  Select,
  SelectValue,
  TextArea,
  Tooltip,
  TooltipTrigger,
} from "react-aria-components";
import type { AgentSessionStatus, AgentViewState } from "../../../shared/models";
import { services } from "../../core/services";
import type { ViewStatus } from "../../core/view-status";
import { Button, IconButton } from "../../ui/controls";
import { ArrowUpIcon, ChevronDownIcon, CloseIcon, EyeIcon, FilesIcon, HistoryIcon, NewChatIcon, PlusIcon, QuoteIcon, StopIcon } from "../../ui/icons";
import { errorMessage } from "../../core/errors";
import { MAX_ATTACHMENTS } from "../../../shared/prompt-attachments";
import { isUnusedConversation, useAgentRuntimes } from "../../core/agent-runtimes";
import { modelLabel, modelSettings, useAgentModels } from "./agent-models";
import { clearComposerResult, emptyComposerRuntime, patchComposer, pendingSettings, useComposerState, type PromptPreview } from "./composer-state";
import { ComposerAttachments } from "./ComposerAttachments";
import { PromptMenuBar } from "./prompt-menus/PromptMenuBar";

export interface ComposerSession {
  status?: AgentSessionStatus;
  display: ViewStatus;
  selection: string;
  interrupt: () => void;
  focusTerminal: () => void;
}

export function AgentComposer({ workspaceId, viewId, agentLabel, state, session, canLaunch, planning, onCollapse }: {
  workspaceId: string;
  viewId: string;
  agentLabel: string;
  state: AgentViewState;
  /** Present once the CLI is running; before that, sending launches it. */
  session?: ComposerSession;
  canLaunch: boolean;
  /** The running or selected harness can enter Plan mode; known before its CLI starts. */
  planning: boolean;
  onCollapse?: () => void;
}) {
  const target = { workspaceId, viewId };
  const runtime = useComposerState((s) => s.views[viewId] ?? emptyComposerRuntime);
  const agent = useAgentRuntimes((s) => s.sessions[viewId]);
  const patch = (value: Pick<AgentViewState, "draft" | "quotations" | "attachments" | "intent" | "modelSettings">) => patchComposer(target, value);
  const providerId = state.providerId ?? "";
  const choices = useAgentModels((s) => s[providerId]) ?? [];
  const settings = choices.length ? modelSettings(providerId, state.modelSettings?.[providerId]) : null;
  const setSettings = (next: { model: string; effort: string } | undefined) => {
    clearComposerResult(viewId);
    const saved = { ...state.modelSettings };
    if (next) saved[providerId] = next; else delete saved[providerId];
    patch({ modelSettings: saved });
  };
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState<PromptPreview>();
  const [historyId, setHistoryId] = useState<string>();
  const [error, setError] = useState("");
  const [copiedRevision, setCopiedRevision] = useState<number>();
  const [dropping, setDropping] = useState(false);
  const status = session?.status;
  const wantsPlan = state.intent === "plan";
  const busy = runtime.sending || runtime.launching;
  const hasDraft = Boolean(state.draft?.trim());
  const attachments = state.attachments ?? [];
  // Model and effort are launch arguments: a change waits for a new conversation (before the first prompt, Send restarts it).
  const pending = session ? pendingSettings(agent, state) : undefined;
  const restartLabel = pending !== undefined ? modelLabel(providerId, pending) : "";
  const unused = Boolean(agent && isUnusedConversation(agent));
  // A CLI that's still starting takes the prompt too: it's held until the CLI is ready.
  const starting = Boolean(session && !status?.canSubmit && status?.lifecycle !== "exited" && status?.lifecycle !== "failed");
  // No model is preselected: a new conversation waits for one. A resumed conversation keeps the model it was started with.
  const needsModel = choices.length > 0 && !settings && !(agent && agent.settings === undefined);
  const canSend = !runtime.attaching && hasDraft && !busy && !needsModel && (!wantsPlan || planning)
    && (session ? starting || Boolean(status?.canSubmit) : canLaunch);
  const historyEntry = runtime.history.find((entry) => entry.id === historyId) ?? runtime.history[0];
  const assembly = () => services.commands.execute<PromptPreview>("agent.composer.preview", target);
  const send = () => {
    if (!canSend) return;
    setError(""); promptRef.current?.focus();
    void services.commands.execute(session ? "agent.composer.send" : "agent.session.launch", { ...target, providerId: state.providerId }).catch((e: unknown) => setError(String(e)));
  };
  const attach = (files: File[]) => {
    if (!files.length) return;
    setError("");
    void services.commands.execute("agent.composer.attach", { ...target, files }).catch((e: unknown) => setError(errorMessage(e)));
  };
  // Native events rather than a drop-zone primitive: only file drags are ours, so text can still be dragged into the prompt.
  const carriesFiles = (event: DragEvent) => event.dataTransfer.types.includes("Files");
  const dragOver = (event: DragEvent) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDropping(true);
  };
  const drop = (event: DragEvent) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    setDropping(false);
    const items = [...event.dataTransfer.items].filter((item) => item.kind === "file");
    const files = items.filter((item) => !item.webkitGetAsEntry()?.isDirectory).flatMap((item) => item.getAsFile() ?? []);
    attach(files);
    if (files.length < items.length) setError("Folders can’t be attached. Drop the files inside them instead.");
  };
  const quote = async () => {
    await services.commands.execute("agent.composer.quote", { ...target, text: session?.selection ?? "" });
    promptRef.current?.focus();
  };
  const waiting = status?.activity === "waiting-for-input" ? "Answer the question in the terminal: your prompt goes as soon as the CLI is ready."
    : status?.inputState === "draft" ? "There’s a draft in the terminal. Send or clear it there, then this prompt goes."
      : "Waiting for the CLI to be ready, then sending…";
  const feedback = error || (runtime.attaching ? "Attaching…" : "") || (runtime.launching ? (session ? waiting : "Starting the CLI…")
    : runtime.sending ? (wantsPlan ? "Switching to Plan mode if needed, then delivering…" : "Delivering prompt…")
      : runtime.result?.outcome === "uncertain" ? `Delivery uncertain. ${runtime.result.message}`
        : runtime.result?.outcome === "not-sent" ? `Not sent. ${runtime.result.message}`
          : needsModel && hasDraft ? "Choose a model to send."
          : !session ? ""
            : pending !== undefined ? (unused ? `Sending restarts the CLI with ${restartLabel}.` : `This conversation runs ${modelLabel(providerId, agent?.settings ?? null)}. Restart to use ${restartLabel}.`)
              : starting ? "The CLI is starting: send now and it goes as soon as it’s ready." : !status?.canSubmit ? status?.reason
                : wantsPlan && status.activity !== "ready" ? "Plan mode switches once the CLI is ready."
                  : (runtime.result?.outcome === "submitted" ? "" : runtime.result?.message) || status?.reason);
  const needsHandoff = session && (!status?.canSubmit || runtime.result?.outcome === "uncertain" || runtime.result?.outcome === "not-sent");

  return <div className="composer-dock">
    {session && <div className="session-strip">
      <div className="session-strip-start">
        <TooltipTrigger delay={300}>
          <AriaButton className={`session-pill tone-${session.display.tone}`} aria-label={`Session status: ${session.display.label}`}>
            <span className="status-dot" />{session.display.label}
          </AriaButton>
          <Tooltip className="wb-tooltip">{session.display.description}</Tooltip>
        </TooltipTrigger>
        {status?.activity === "working" && <Button className="strip-button" onPress={session.interrupt}><StopIcon size={13} />Interrupt</Button>}
      </div>
      <div className="session-strip-end">
        <Button className="strip-button" isDisabled={!session.selection.trim()} onPress={() => void quote()}><QuoteIcon size={13} />Add to prompt</Button>
        <Button className="strip-button" onPress={() => { void assembly().then(setPreview).catch((e: unknown) => setError(String(e))); }}><EyeIcon size={13} />Preview</Button>
        <DialogTrigger>
          <Button className="strip-button" isDisabled={!runtime.history.length} aria-label="Activity"><HistoryIcon size={13} />Activity{runtime.history.length > 0 && <span className="strip-count">{runtime.history.length}</span>}</Button>
          <Popover className="wb-popover composer-history" placement="top end">
            <Dialog aria-label="Recent prompts">
              {({ close }) => <>
                <h3>Recent prompts</h3>
                <p className="composer-note">This session, until the app closes. Recall uses your current persona and instructions.</p>
                <ListBox aria-label="Prompt history" selectionMode="single" selectedKeys={historyEntry ? [historyEntry.id] : []}
                  onSelectionChange={(keys) => { if (keys !== "all") setHistoryId(String([...keys][0])); }}>
                  {runtime.history.map((entry) => <ListBoxItem key={entry.id} id={entry.id} textValue={entry.draft || "Quoted context"}>
                    <span>{entry.draft || "Quoted context"}</span><small>{entry.outcome === "saved" ? "Saved draft" : entry.outcome === "submitted" ? "Handed to CLI" : entry.outcome === "uncertain" ? "Delivery uncertain" : "Not sent"} · {new Date(entry.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small>
                  </ListBoxItem>)}
                </ListBox>
                {historyEntry && <>
                  <p className="composer-note" title={historyEntry.message}>{historyEntry.preview.intent === "plan" ? "Planning request" : "Code mode"}</p>
                  <pre className="prompt-preview-text">{historyEntry.preview.content}</pre>
                  <Button onPress={() => { void services.commands.execute("agent.composer.recall", { ...target, entryId: historyEntry.id }).then(() => {
                    close(); promptRef.current?.focus();
                  }).catch((e: unknown) => { close(); setError(e instanceof Error ? e.message : String(e)); }); }}>Use as draft</Button>
                </>}
              </>}
            </Dialog>
          </Popover>
        </DialogTrigger>
        <Button className="strip-button" onPress={() => void services.commands.execute("agent.session.reset", target)}><NewChatIcon size={13} />New conversation</Button>
      </div>
    </div>}
    <div className={`composer-box ${dropping ? "is-dropping" : ""}`} onDragOver={dragOver} onDrop={drop}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false); }}>
      {dropping && <div className="composer-drop-hint"><FilesIcon size={16} />Drop to attach</div>}
      <div className="composer-box-top">
        {(attachments.length > 0 || runtime.attaching > 0 || !!state.quotations?.length) && <div className="composer-context">
          <ComposerAttachments viewId={viewId} attachments={attachments} pending={runtime.attaching}
            onRemove={(id) => patch({ attachments: attachments.filter((item) => item.id !== id) })} />
          {!!state.quotations?.length && <div className="composer-quotations" aria-label={`Quoted context: ${state.quotations.length} selections`}>
            {state.quotations.map((item, index) => <div className="composer-quotation" key={item.id}>
              <details><summary>Terminal selection {index + 1}</summary><pre>{item.content}</pre></details>
              <IconButton label={`Remove terminal selection ${index + 1}`} onPress={() => patch({ quotations: state.quotations?.filter((quote) => quote.id !== item.id) })}><CloseIcon size={11} /></IconButton>
            </div>)}
          </div>}
        </div>}
        <span className="kbd-hint">⌘/Ctrl + Enter</span>
        {onCollapse && <IconButton label="Collapse composer" onPress={onCollapse}><ChevronDownIcon size={14} /></IconButton>}
      </div>
      <TextArea ref={promptRef} aria-label="Prompt" placeholder={`Ask ${agentLabel} to build, investigate, or refine…`} value={state.draft ?? ""}
        onChange={(event) => patch({ draft: event.currentTarget.value })}
        onPaste={(event) => {
          // A copied file or screenshot; when there is text too (a spreadsheet's cells), the text is what was meant.
          const files = [...event.clipboardData.files];
          if (files.length && !event.clipboardData.getData("text/plain")) { event.preventDefault(); attach(files); }
        }}
        onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); send(); } }} />
      <div className="composer-feedback" aria-live="polite">{feedback}</div>
      {needsHandoff && <div className="composer-handoff">
        {status?.lifecycle === "failed" && <Button onPress={() => void services.commands.execute("agent.session.forget", target)}>Start new session</Button>}
        <Button onPress={session.focusTerminal}>Focus terminal</Button>
        <Button onPress={() => { void assembly().then((value) => navigator.clipboard.writeText(value.content)).then(() => setCopiedRevision(state.composerRevision ?? 0)).catch(() => setError("Could not copy. Open Preview to select the prompt text.")); }}>{copiedRevision === (state.composerRevision ?? 0) ? "Copied prompt" : "Copy composed prompt"}</Button>
      </div>}
      {pending !== undefined && !unused && !busy && <div className="composer-handoff">
        <Button onPress={() => { void services.commands.execute("agent.session.restart", target).catch((e: unknown) => setError(String(e))); }}>Restart with {restartLabel}</Button>
      </div>}
      <div className="composer-toolbar">
        <div className="composer-toolbar-start">
          <FileTrigger allowsMultiple onSelect={(list) => attach([...(list ?? [])])}>
            <IconButton label="Attach files" className="composer-attach" isDisabled={attachments.length + runtime.attaching >= MAX_ATTACHMENTS}><PlusIcon size={17} /></IconButton>
          </FileTrigger>
          <span className="composer-toolbar-divider" aria-hidden="true" />
          <PromptMenuBar target={target} selections={state.promptSelections ?? {}} />
        </div>
        <div className="composer-toolbar-end">
          {services.widgets.forSlot("agent.composer.toolbar").map((widget) => {
            const Widget = widget.component;
            return <Widget key={widget.id} workspaceId={workspaceId} viewId={viewId} />;
          })}
          {choices.length > 0 && <>
            <Select aria-label="Model" placeholder="Select model" selectedKey={settings?.model ?? null} isDisabled={busy}
              onSelectionChange={(key) => {
                const model = choices.find((choice) => choice.id === key);
                if (model) setSettings({ model: model.id, effort: model.efforts.includes(settings?.effort ?? "medium") ? settings?.effort ?? "medium" : model.efforts[0] });
              }}>
              <AriaButton className="composer-chip"><SelectValue /><ChevronDownIcon size={12} /></AriaButton>
              <Popover className="wb-popover" placement="top end"><ListBox>
                {choices.map((model) => <ListBoxItem key={model.id} id={model.id}>{model.label}</ListBoxItem>)}
              </ListBox></Popover>
            </Select>
            {settings && <Select aria-label="Effort" selectedKey={settings.effort} isDisabled={busy}
              onSelectionChange={(key) => { if (key) setSettings({ model: settings.model, effort: String(key) }); }}>
              <AriaButton className="composer-chip"><SelectValue /><ChevronDownIcon size={12} /></AriaButton>
              <Popover className="wb-popover" placement="top end"><ListBox>
                {choices.find((model) => model.id === settings.model)?.efforts.map((effort) => <ListBoxItem key={effort} id={effort}>{effort}</ListBoxItem>)}
              </ListBox></Popover>
            </Select>}
          </>}
          <Select aria-label="Mode" className="mode-select" selectedKey={wantsPlan ? "plan" : "default"}
            disabledKeys={planning || wantsPlan ? [] : ["plan"]} onSelectionChange={(key) => patch({ intent: key === "plan" ? "plan" : "default" })}>
            <AriaButton className="composer-chip"><SelectValue>{({ selectedText }) => selectedText}</SelectValue><ChevronDownIcon size={12} /></AriaButton>
            <Popover className="wb-popover" placement="top end">
              <ListBox>
                <ListBoxItem id="default" textValue="Code"><div><span>Code</span><small>Leaves the CLI’s Plan mode if it’s on</small></div></ListBoxItem>
                <ListBoxItem id="plan" textValue="Plan"><div><span>Plan</span><small>{planning ? "Enters the CLI’s Plan mode" : "Not supported by this CLI"}</small></div></ListBoxItem>
              </ListBox>
            </Popover>
          </Select>
          <Button className="send-button" aria-label={wantsPlan ? "Send for planning" : "Send prompt"} isDisabled={!canSend} onPress={send}>
            <ArrowUpIcon size={16} />
          </Button>
        </div>
      </div>
    </div>
    {wantsPlan && <p className="composer-plan-note" id={`plan-note-${viewId}`}>{!planning
      ? "This provider does not support planning submissions. Switch to Code to send normally."
      : session ? "Enters the CLI’s Plan mode. Sending with Code leaves it again."
        : "Sending starts the CLI, enters its Plan mode, then delivers your prompt."}</p>}
    <ModalOverlay className="wb-modal-overlay" isDismissable isOpen={Boolean(preview)} onOpenChange={(open) => { if (!open) setPreview(undefined); }}>
      <Modal className="wb-modal composer-preview-modal"><Dialog aria-label="Prompt preview" className="wb-dialog">
        <div className="dialog-header"><div><h2>Prompt preview</h2><p>{preview?.intent === "plan" ? "Send for planning · enters the CLI’s Plan mode" : "Send · Code mode (leaves Plan mode if it’s on)"}</p></div><Button onPress={() => setPreview(undefined)}>Close</Button></div>
        <div className="composer-preview-body">
          <div className="prompt-sources" aria-label="Included context">
            {preview?.contributions.filter((item) => item.placement !== "append").map((item) => <span key={`${item.kind}-${item.id}`}>{item.source}</span>)}
            <span className="is-prompt">Your prompt</span>
            {preview?.contributions.filter((item) => item.placement === "append").map((item) => <span key={`${item.kind}-${item.id}`}>{item.source}</span>)}
          </div>
          <pre className="prompt-preview-text" tabIndex={0}>{preview?.content || "Nothing to send yet."}</pre>
        </div>
      </Dialog></Modal>
    </ModalOverlay>
  </div>;
}
