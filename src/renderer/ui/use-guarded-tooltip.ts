import { useEffect, useState, type RefObject } from "react";

/**
 * Controlled tooltip state that cannot get stuck. Dragging the window by the title bar swallows the
 * trigger's pointer-leave, so the tooltip would stay open at a stale position. While it is open we
 * also close it when the pointer moves off the trigger, on any press, or when the window loses focus.
 */
export function useGuardedTooltip(triggerRef: RefObject<HTMLElement | null>) {
  const [isOpen, setOpen] = useState(false);
  useEffect(() => {
    if (!isOpen) return;
    const close = () => setOpen(false);
    const onMove = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !triggerRef.current?.contains(event.target)) close();
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerdown", close, true);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerdown", close, true);
      window.removeEventListener("blur", close);
    };
  }, [isOpen, triggerRef]);
  return { isOpen, onOpenChange: setOpen };
}
