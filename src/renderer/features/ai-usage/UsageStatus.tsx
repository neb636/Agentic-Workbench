import { useState } from "react";
import { Button as AriaButton, Dialog, DialogTrigger, Popover, ToggleButton, ToggleButtonGroup } from "react-aria-components";
import { tightestWindow, type ProviderUsage, type UsageCredits, type UsageWindow } from "../../../shared/ai-usage";
import { services } from "../../core/services";
import { IconButton } from "../../ui/controls";
import { ChevronRightIcon, RefreshIcon, WarningIcon } from "../../ui/icons";
import { UsageMeter } from "./UsageMeter";
import { formatAgo, formatDuration, formatMoney, formatPercent, refreshAiUsage, useAiUsage, useAiUsageConfiguration, useAiUsageSettings, useNow } from "./usage-store";

function Mark({ providerId, size = 14 }: { providerId: string; size?: number }) {
  const Icon = services.sessions.get(providerId)?.icon;
  return Icon ? <Icon size={size} /> : null;
}

const resetIn = (window: UsageWindow, now: number) => window.resetsAt ? formatDuration(window.resetsAt - now) : undefined;

/** The window that resets first: what "Resets in" refers to for a provider. */
function soonestReset(usage: ProviderUsage): UsageWindow | undefined {
  return usage.windows.filter((window) => window.resetsAt).sort((a, b) => (a.resetsAt ?? 0) - (b.resetsAt ?? 0))[0];
}

/**
 * "2% 4h 30m · 25% 4d 1h · 10% Fable": each window with its reset countdown, or its name when an earlier window
 * already shows the same reset. Compact shows the tightest window only.
 */
function windowsText(usage: ProviderUsage, now: number, compact: boolean): string {
  const windows = usage.windows;
  const shown = compact ? [tightestWindow(usage)].filter((item): item is UsageWindow => Boolean(item)) : windows;
  return shown.map((window) => {
    const earlier = windows.slice(0, windows.indexOf(window));
    const repeated = window.resetsAt !== undefined && earlier.some((other) => other.resetsAt !== undefined && Math.abs(other.resetsAt - window.resetsAt!) < 60_000);
    return `${formatPercent(window.usedPercent)} ${!repeated && resetIn(window, now) || window.shortLabel}`;
  }).join(" · ");
}

function describe(usage: ProviderUsage, now: number): string {
  if (!usage.windows.length) return `${usage.label}: ${usage.message ?? "reading usage"}`;
  const windows = usage.windows.map((window) => `${window.label} ${formatPercent(window.usedPercent)} used${window.resetsAt ? `, resets in ${resetIn(window, now)}` : ""}`);
  return `${usage.label}: ${windows.join("; ")}${usage.status === "stale" ? ` (${usage.message ?? "out of date"})` : ""}`;
}

const isWarning = (usage: ProviderUsage) => usage.status === "stale" || usage.status === "error";

function StatusChip({ usage, now, compact }: { usage: ProviderUsage; now: number; compact: boolean }) {
  const tightest = tightestWindow(usage);
  return <span className="ai-usage-chip">
    <Mark providerId={usage.providerId} size={12} />
    {usage.status === "loading" && !tightest ? <span className="status-muted">···</span> : !tightest ? <span className="status-muted">--</span> : <>
      <UsageMeter decorative size="mini" percent={tightest.usedPercent} />
      <span>{windowsText(usage, now, compact)}</span>
    </>}
    {isWarning(usage) && <span className="ai-usage-warning"><WarningIcon size={11} /></span>}
  </span>;
}

function credits(value: UsageCredits): { text: string; percent?: number } {
  if (!value.currency) return { text: value.unlimited ? "Unlimited credits" : `${value.balance ?? 0} credits left` };
  if (value.limit !== undefined) {
    const used = value.used ?? 0;
    return { text: `${formatMoney(used, value.currency)} / ${formatMoney(value.limit, value.currency)}`, percent: value.limit > 0 ? Math.min(100, (used / value.limit) * 100) : 0 };
  }
  return { text: `${formatMoney(value.balance ?? 0, value.currency)} available` };
}

function UsageDetail({ usage, now }: { usage: ProviderUsage; now: number }) {
  const extra = usage.credits && credits(usage.credits);
  const updated = usage.updatedAt ? `${usage.source === "live" ? "Live · " : ""}Updated ${formatAgo(now - usage.updatedAt)}` : usage.status === "loading" ? "Reading…" : "";
  return <>
    <div className="ai-usage-detail-head">
      <span className="ai-usage-detail-title"><Mark providerId={usage.providerId} size={16} />{usage.label}</span>
      <span className="status-muted">{updated}</span>
    </div>
    {usage.message && <p className={`ai-usage-detail-message ${isWarning(usage) ? "is-warning" : ""}`}>{isWarning(usage) && <WarningIcon size={12} />}{usage.message}</p>}
    {(usage.windows.length > 0 || extra) && <div className="ai-usage-card">
      {usage.plan && <div className="ai-usage-card-title">{usage.plan}</div>}
      {usage.windows.map((window) => <div key={window.id} className="ai-usage-window">
        <div className="ai-usage-window-label">{window.label}</div>
        <UsageMeter size="full" percent={window.usedPercent} label={`${usage.label} ${window.label}`} />
        <div className="ai-usage-window-foot"><span>{formatPercent(window.usedPercent)} used</span><span>{window.resetsAt ? `Resets in ${resetIn(window, now)}` : ""}</span></div>
      </div>)}
      {extra && <div className="ai-usage-window">
        <div className="ai-usage-window-label">Usage credits</div>
        {extra.percent !== undefined && <UsageMeter size="full" percent={extra.percent} label={`${usage.label} usage credits`} />}
        <div className="ai-usage-window-foot"><span>{extra.text}</span><span>{extra.percent !== undefined ? `${formatPercent(extra.percent)} used` : ""}</span></div>
      </div>}
    </div>}
  </>;
}

function ProviderRow({ usage, now, compact }: { usage: ProviderUsage; now: number; compact: boolean }) {
  const soonest = soonestReset(usage);
  const tightest = tightestWindow(usage);
  return <DialogTrigger>
    <AriaButton className="ai-usage-row">
      <span className="ai-usage-row-mark"><Mark providerId={usage.providerId} size={16} /></span>
      <span className="ai-usage-row-body">
        <span className="ai-usage-row-head">
          <span className="ai-usage-row-label">{usage.label}{usage.plan && <span className="status-muted"> · {usage.plan}</span>}</span>
          {soonest && <span className="status-muted">Resets in {resetIn(soonest, now)}</span>}
        </span>
        {usage.windows.length > 0 && (compact && tightest
          ? <span className="ai-usage-row-windows"><span className="ai-usage-row-window"><span className="status-muted">{tightest.shortLabel}</span><span>{formatPercent(tightest.usedPercent)}</span></span></span>
          : <span className="ai-usage-row-windows">{usage.windows.map((window) => <span key={window.id} className="ai-usage-row-window">
            <span className="status-muted">{window.shortLabel}</span><UsageMeter decorative size="row" percent={window.usedPercent} /><span>{formatPercent(window.usedPercent)}</span>
          </span>)}</span>)}
        {usage.message && <span className={`ai-usage-row-message ${isWarning(usage) ? "is-warning" : ""}`}>{isWarning(usage) && <WarningIcon size={11} />}{usage.message}</span>}
        {usage.status === "loading" && !usage.windows.length && <span className="ai-usage-row-message">Reading…</span>}
      </span>
      <ChevronRightIcon size={13} />
    </AriaButton>
    <Popover className="wb-popover ai-usage-detail-popover" placement="end top" offset={8}>
      <Dialog aria-label={`${usage.label} usage`} className="ai-usage-detail"><UsageDetail usage={usage} now={now} /></Dialog>
    </Popover>
  </DialogTrigger>;
}

/** The status bar's plan usage for each agent; pressed, it lists them with each one's details a step further. */
export function UsageStatus() {
  const settings = useAiUsageConfiguration();
  const [, update] = useAiUsageSettings();
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const snapshot = useAiUsage((state) => state.snapshot);
  const now = useNow(settings.enabled);
  if (!settings.enabled) return null;
  const providers = snapshot?.providers ?? [];
  const compact = settings.display === "compact";
  const chips = providers.filter((usage) => usage.windows.length || usage.status === "loading");
  const refresh = () => { setRefreshing(true); void refreshAiUsage().finally(() => setRefreshing(false)); };
  return <DialogTrigger isOpen={open} onOpenChange={setOpen}>
    <AriaButton className="status-item status-button ai-usage-status" aria-label={`AI usage. ${chips.map((usage) => describe(usage, now)).join(". ")}`}>
      <span className="status-muted">Used</span>
      {chips.length ? chips.map((usage) => <StatusChip key={usage.providerId} usage={usage} now={now} compact={compact} />) : <span className="status-muted">--</span>}
    </AriaButton>
    <Popover className="wb-popover ai-usage-popover" placement="top end">
      <Dialog aria-label="AI usage" className="ai-usage-dialog">
        <div className="ai-usage-header">
          <span className="ai-usage-title">Usage</span>
          <IconButton label="Refresh usage" isDisabled={refreshing} onPress={refresh}><RefreshIcon size={13} /></IconButton>
        </div>
        <ToggleButtonGroup aria-label="Detail level" className="segmented ai-usage-modes" selectionMode="single" disallowEmptySelection
          selectedKeys={[settings.display]} onSelectionChange={(keys) => { const [key] = [...keys]; if (key === "detailed" || key === "compact") update({ display: key }); }}>
          <ToggleButton id="detailed" className="segment">Detailed</ToggleButton>
          <ToggleButton id="compact" className="segment">Compact</ToggleButton>
        </ToggleButtonGroup>
        {providers.length
          ? <div className="ai-usage-rows">{providers.map((usage) => <ProviderRow key={usage.providerId} usage={usage} now={now} compact={compact} />)}</div>
          : <p className="ai-usage-empty">No installed agent reports plan usage.</p>}
      </Dialog>
    </Popover>
  </DialogTrigger>;
}
