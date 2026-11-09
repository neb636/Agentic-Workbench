import { useEffect, useRef, useState, type MouseEvent, type KeyboardEvent, type ReactNode } from "react";
import { Button, Menu, MenuItem, MenuTrigger, Popover, Separator } from "react-aria-components";
import { MoreIcon } from "./icons";

export interface ContextAction {
  id: string; label: string; run: () => void | Promise<unknown>; disabled?: boolean; destructive?: boolean; section?: string; shortcut?: string;
}
/** Shared pointer/keyboard menu. The caller's row remains the focus owner. */
export function useContextMenu(label: string) {
  const [menu, setMenu] = useState<{ x: number; y: number; actions: ContextAction[]; owner: HTMLElement }>();
  useEffect(() => {
    const owner = menu?.owner;
    owner?.setAttribute("data-context-target", "true");
    return () => owner?.removeAttribute("data-context-target");
  }, [menu]);
  const anchor = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const run = (action: ContextAction) => { void Promise.resolve().then(action.run).catch((e: unknown) => setError(String(e))); };
  const close = (action?: ContextAction) => {
    const owner = menu?.owner; setMenu(undefined);
    requestAnimationFrame(() => { owner?.focus(); if (action) run(action); });
  };
  const focusOwner = (target: Element, current: Element): HTMLElement =>
    target.closest<HTMLElement>('[contenteditable="true"], textarea, input, [role="row"], [role="tab"], [tabindex]')
      ?? current.querySelector<HTMLElement>('[contenteditable="true"], textarea, input, [tabindex]')
      ?? current as HTMLElement;
  const bind = (actions: (target: Element) => ContextAction[], prepare?: () => void): { onContextMenu: (event: MouseEvent<Element>) => void; onKeyDown: (event: KeyboardEvent<Element>) => void } => ({
    onContextMenu: (event) => {
      const items = actions(event.target as Element);
      if (!items.length) return;
      event.preventDefault(); event.stopPropagation(); prepare?.();
      const owner = focusOwner(event.target as Element, event.currentTarget);
      const box = event.currentTarget.getBoundingClientRect();
      setMenu({ x: event.clientX || box.left, y: event.clientY || box.bottom, actions: items, owner });
    },
    onKeyDown: (event) => {
      if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
      const items = actions(event.target as Element);
      if (!items.length) return;
      event.preventDefault(); event.stopPropagation(); prepare?.();
      const owner = focusOwner(event.target as Element, event.currentTarget);
      const box = owner.getBoundingClientRect();
      setMenu({ x: box.left, y: box.bottom, actions: items, owner });
    },
  });
  const renderItems = (actions: ContextAction[]) => actions.flatMap((item, index) => [
    ...(index && item.section !== actions[index - 1].section ? [<Separator key={`separator-${item.id}`} className="context-menu-separator" />] : []),
    <MenuItem key={item.id} id={item.id} textValue={item.label} isDisabled={item.disabled} className={item.destructive ? "is-destructive" : ""}><span>{item.label}</span>{item.shortcut && <kbd className="context-menu-shortcut" aria-hidden="true">{item.shortcut}</kbd>}</MenuItem>,
  ]);
  const overflow = (actions: ContextAction[], name = label): ReactNode => <MenuTrigger>
    <Button className="row-action" aria-label={`${name} actions`}><MoreIcon size={13} /></Button>
    <Popover className="wb-popover wb-context-popover" placement="bottom end"><Menu aria-label={`${name} actions`} onAction={(key) => { const action = actions.find((a) => a.id === key); if (action) run(action); }}>{renderItems(actions)}</Menu></Popover>
  </MenuTrigger>;
  const overlay = <>
    <div ref={anchor} className="context-menu-anchor" style={menu ? { left: menu.x, top: menu.y } : undefined} />
    {menu && <Popover className="wb-popover wb-context-popover" triggerRef={anchor} isOpen placement="bottom start" onOpenChange={(open) => { if (!open) close(); }}>
      <Menu aria-label={label} autoFocus="first" onAction={(key) => { const action = menu.actions.find((a) => a.id === key); close(action); }}>{renderItems(menu.actions)}</Menu>
    </Popover>}
    {error && <div className="context-menu-error" role="alert">{error}<button onClick={() => setError("")}>Dismiss</button></div>}
  </>;
  return { bind, overlay, overflow };
}
