import { useEffect, useRef } from "react";
import { Button as AriaButton, DropZone, FileTrigger, ListBox, ListBoxItem, Popover, Select, SelectValue, TextArea } from "react-aria-components";
import type { ImageGeneratorViewState } from "../../../shared/models";
import { closeAgentRuntime, useAgentRuntimes } from "../../core/agent-runtimes";
import { services } from "../../core/services";
import type { ViewComponentProps } from "../../core/view-registry";
import { Button, IconButton } from "../../ui/controls";
import { ArrowUpIcon, ChevronDownIcon, ChevronUpIcon, CloseIcon, ImageIcon, NewChatIcon, PaperclipIcon, StopIcon } from "../../ui/icons";
import { agentRuntimeStatus } from "../agent/session-status";
import { TerminalSurface } from "../terminal/TerminalSurface";
import { attachImages, DEFAULT_COUNT, emptyImageRuntime, patchImageView, useImageRuntimes } from "./image-generator-state";
import { CharacterWorkflow } from "./CharacterWorkflow";
import { AttachmentThumb, RunSection } from "./RunGallery";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const COUNTS = [1];

export function ImageGeneratorView({ view, workspace }: ViewComponentProps) {
  const state = (view.state ?? {}) as ImageGeneratorViewState;
  const target = { workspaceId: workspace.id, viewId: view.id };
  const runtime = useAgentRuntimes((s) => s.sessions[view.id]);
  const imageRuntime = useImageRuntimes((s) => s.views[view.id] ?? emptyImageRuntime);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const patch = (value: Partial<ImageGeneratorViewState>) => patchImageView(target, value);
  const activity = runtime?.status?.activity;
  // Permission and trust prompts are answered in the agent's own terminal.
  useEffect(() => { if (activity === "waiting-for-input") patchImageView({ workspaceId: workspace.id, viewId: view.id }, { agentOpen: true }); }, [activity, workspace.id, view.id]);

  const attachments = state.attachments ?? [];
  const runs = state.runs ?? [];
  const count = DEFAULT_COUNT;
  const canGenerate = Boolean(state.draft?.trim()) && !imageRuntime.sending;
  const generate = () => { if (canGenerate) void services.commands.execute("image.generate", target); };
  const attach = (files: File[]) => void attachImages(target, files);
  const display = runtime && agentRuntimeStatus(runtime);

  return <section className="image-view" aria-label="Character concepts">
    <CharacterWorkflow view={view} workspace={workspace} />
    <div className="image-gallery">
      {runs.length
        ? runs.map((run) => <RunSection key={run.id} target={target} run={run} />)
        : <div className="image-empty">
          <ImageIcon size={28} />
          <h3>Make a vinyl character</h3>
          <p>One transparent, front-facing A-pose concept per run. Open the result and choose “Refine from this” to keep the same character and request one change. Sources stay in the local studio library.</p>
        </div>}
    </div>
    <div className="image-dock">
      <div className="session-strip">
        <div className="session-strip-start">
          {display && <span className={`session-pill tone-${display.tone}`} title={display.description}><span className="status-dot" />{display.label}</span>}
          {activity === "working" && <Button className="strip-button" onPress={() => runtime?.controller.interrupt()}><StopIcon size={13} />Interrupt</Button>}
        </div>
        <div className="session-strip-end">
          {runtime && <Button className="strip-button" onPress={() => closeAgentRuntime(view.id)}><NewChatIcon size={13} />New conversation</Button>}
          <Button className="strip-button" isDisabled={!runtime} onPress={() => patch({ agentOpen: !state.agentOpen })}>
            {state.agentOpen ? <ChevronDownIcon size={13} /> : <ChevronUpIcon size={13} />}{state.agentOpen ? "Hide agent" : "Show agent"}
          </Button>
        </div>
      </div>
      {runtime && state.agentOpen && <div className="terminal-card image-agent"><TerminalSurface controller={runtime.controller} /></div>}
      <DropZone className="image-dropzone" aria-label="Drop images to attach"
        getDropOperation={(types) => IMAGE_TYPES.some((type) => types.has(type)) ? "copy" : "cancel"}
        onDrop={(event) => {
          void Promise.all(event.items.flatMap((item) => item.kind === "file" && item.type.startsWith("image/") ? [item.getFile()] : [])).then(attach);
        }}>
        <div className="composer-box">
          {attachments.length > 0 && <div className="image-attachments" aria-label={`${attachments.length} attached images`}>
            {attachments.map((item) => <div className="image-attachment" key={item.id} title={item.name}>
              <AttachmentThumb viewId={view.id} file={item.file} name={item.name} />
              <IconButton label={`Remove ${item.name}`} onPress={() => patch({ attachments: attachments.filter((other) => other.id !== item.id) })}><CloseIcon size={11} /></IconButton>
            </div>)}
          </div>}
          <TextArea ref={promptRef} aria-label="Image prompt" placeholder="Describe the person, their chosen animal and clothes, or one change to the attached concept…" value={state.draft ?? ""}
            onChange={(event) => patch({ draft: event.currentTarget.value })}
            onPaste={(event) => {
              const files = [...event.clipboardData.files].filter((file) => file.type.startsWith("image/"));
              if (files.length) { event.preventDefault(); attach(files); }
            }}
            onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); generate(); } }} />
          <div className="composer-feedback" aria-live="polite">{imageRuntime.error || (imageRuntime.sending ? "Handing the request to Claude…" : "")}</div>
          <div className="composer-toolbar">
            <div className="composer-toolbar-start">
              <label className="composer-chip">Orchestrator <select aria-label="Concept agent" value={state.providerId ?? 'claude.cli'} disabled={Boolean(runtime)} onChange={e => patch({ providerId: e.target.value })}><option value="claude.cli">Claude Code</option><option value="codex.cli">Codex CLI</option></select></label>
              <FileTrigger acceptedFileTypes={IMAGE_TYPES} allowsMultiple onSelect={(files) => { if (files) attach([...files]); }}>
                <AriaButton className="composer-chip"><PaperclipIcon size={14} />Attach</AriaButton>
              </FileTrigger>
            </div>
            <div className="composer-toolbar-end">
              <Select aria-label="Number of variants" className="mode-select" selectedKey={count} onSelectionChange={(key) => patch({ count: Number(key) })}>
                <AriaButton className="composer-chip"><SelectValue>{({ selectedText }) => `${selectedText} concept`}</SelectValue><ChevronDownIcon size={12} /></AriaButton>
                <Popover className="wb-popover" placement="top end">
                  <ListBox>{COUNTS.map((value) => <ListBoxItem key={value} id={value} textValue={String(value)}>{value}</ListBoxItem>)}</ListBox>
                </Popover>
              </Select>
              <span className="kbd-hint">⌘/Ctrl + Enter</span>
              <Button className="send-button" aria-label="Generate images" isDisabled={!canGenerate} onPress={generate}><ArrowUpIcon size={16} /></Button>
            </div>
          </div>
        </div>
      </DropZone>
    </div>
  </section>;
}
