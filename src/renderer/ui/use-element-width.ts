import { useEffect, useState, type RefObject } from "react";

/** The element's width, kept up to date as it resizes (0 until measured or while hidden). */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(() => { if (element.clientWidth) setWidth(element.clientWidth); });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
