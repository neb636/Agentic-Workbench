import { useMemo } from "react";
import { Button as AriaButton, Menu, MenuItem, MenuTrigger, Popover, Separator } from "react-aria-components";
import type { Workspace } from "../../../shared/models";
import type { TextSelection } from "../../core/context-menu-registry";
import { services } from "../../core/services";
import { sendShortcut } from "./selection-target";
import { FileIcon, SparkIcon } from "../../ui/icons";

function linesLabel({ fromLine, toLine }: TextSelection): string {
  return fromLine === toLine ? `Line ${fromLine}` : `Lines ${fromLine}–${toLine}`;
}

/**
 * The floating "Send to agent" pill beside selected code and the list it opens: where the selection can go, as
 * contributed for the `selection` menu target. `selection` is the snapshot taken when the list opened.
 */
export function SelectionActions({ workspace, selection, position, onOpen, onClose, onError }: {
  workspace: Workspace;
  selection: TextSelection | undefined;
  position: { top: number; left: number };
  onOpen: () => void;
  /** `sent`: an action ran, so the editor shouldn't take focus back. */
  onClose: (sent: boolean) => void;
  onError: (error: unknown) => void;
}) {
  const actions = useMemo(() => selection ? services.contextMenus.forTarget({ kind: "selection", workspace, selection }) : [], [selection, workspace]);
  const name = selection?.location.path.split("/").at(-1) ?? "";
  return <MenuTrigger isOpen={Boolean(selection)} onOpenChange={(open) => { if (open) onOpen(); else onClose(false); }}>
    <AriaButton className="selection-pill" style={{ top: position.top, left: position.left }} aria-label="Send selection to agent"
      // Pressing the pill must not collapse the editor's selection first.
      onPointerDown={(event) => event.preventDefault()}>
      <SparkIcon size={12} /><span>Send to agent</span><kbd aria-hidden="true">{sendShortcut()}</kbd>
    </AriaButton>
    <Popover className="wb-popover selection-popover" placement="bottom start" offset={6}>
      {selection && <div className="selection-popover-head">
        <span className="selection-popover-file"><FileIcon size={13} /><strong>{name}</strong></span>
        <span className="selection-popover-lines">{linesLabel(selection)}</span>
      </div>}
      <Menu aria-label="Send selection to" autoFocus="first" onAction={(key) => {
        const action = actions.find((item) => item.id === key);
        onClose(true);
        if (action) void Promise.resolve().then(action.run).catch(onError);
      }}>
        {actions.flatMap((item, index) => [
          ...(index && item.section !== actions[index - 1].section ? [<Separator key={`separator-${item.id}`} className="context-menu-separator" />] : []),
          <MenuItem key={item.id} id={item.id} textValue={item.label} isDisabled={item.disabled} className="send-target">
            {item.icon}
            <div><span className="send-target-label">{item.label}</span>{item.detail && <small>{item.detail}</small>}</div>
          </MenuItem>,
        ])}
      </Menu>
    </Popover>
  </MenuTrigger>;
}
