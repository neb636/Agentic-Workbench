import { useCallback, useEffect, useState, type RefObject } from "react";

/** A trigger the tooltip can be placed against: still in the document and laid out with a real box. */
function isPlaceable(element: HTMLElement | null): element is HTMLElement {
  if (!element?.isConnected) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/**
 * Controlled tooltip state that cannot get stuck. Dragging the window by the title bar swallows the
 * trigger's pointer-leave, so the tooltip would stay open at a stale position. While it is open we
 * also close it when the pointer moves off the trigger, on any press, or when the window loses focus.
 *
 * It also never opens, or stays open, for a trigger that has no layout box (collapsed panel, hidden
 * window, detached node). React Aria would have nothing to measure and leave the tooltip at its
 * unpositioned fallback, the window's top-left corner. `.wb-tooltip:not([data-placement])` hides that
 * fallback for any tooltip that still slips through.
 */
export function useGuardedTooltip(triggerRef: RefObject<HTMLElement | null>) {
  const [isOpen, setOpen] = useState(false);
  const onOpenChange = useCallback((open: boolean) => {
    setOpen(open && isPlaceable(triggerRef.current));
  }, [triggerRef]);
  useEffect(() => {
    if (!isOpen) return;
    const trigger = triggerRef.current;
    const close = () => setOpen(false);
    if (!isPlaceable(trigger)) { close(); return; }
    const onMove = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !trigger.contains(event.target)) close();
    };
    const onHidden = () => { if (document.visibilityState !== "visible") close(); };
    const observer = new ResizeObserver(() => { if (!isPlaceable(trigger)) close(); });
    observer.observe(trigger);
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      observer.disconnect();
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, [isOpen, triggerRef]);
  return { isOpen, onOpenChange };
}
