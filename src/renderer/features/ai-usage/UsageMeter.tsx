import { Meter } from "react-aria-components";
import { formatPercent } from "./usage-store";

/** Accent until a limit is close: warning from 80%, critical from 95%. */
const meterTone = (percent: number) => percent >= 95 ? "is-critical" : percent >= 80 ? "is-warning" : "";

/** A usage bar. `decorative` draws only the bar, for places whose text already states the figure. */
export function UsageMeter({ percent, label, size, decorative }: { percent: number; label?: string; size: "mini" | "row" | "full"; decorative?: boolean }) {
  const bar = <span className="ai-usage-meter-fill" style={{ width: `${percent}%` }} />;
  const className = `ai-usage-meter is-${size} ${meterTone(percent)}`;
  if (decorative) return <span className={className} aria-hidden="true">{bar}</span>;
  return <Meter value={percent} aria-label={label} valueLabel={formatPercent(percent)} className={className}>{bar}</Meter>;
}
