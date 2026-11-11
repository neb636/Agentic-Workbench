import { useRef } from "react";
import { useGuardedTooltip } from "./use-guarded-tooltip";
import {
  Button as AriaButton,
  Tooltip,
  TooltipTrigger,
  type ButtonProps,
} from "react-aria-components";

export function Button({ className, ...props }: ButtonProps) {
  return <AriaButton {...props} className={`wb-button ${className ?? ""}`} />;
}

export function IconButton({ label, className, ...props }: ButtonProps & { label: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <TooltipTrigger delay={500} {...useGuardedTooltip(ref)}>
      <AriaButton {...props} ref={ref} aria-label={label} className={`wb-icon-button ${className ?? ""}`} />
      <Tooltip className="wb-tooltip" offset={6}>{label}</Tooltip>
    </TooltipTrigger>
  );
}
