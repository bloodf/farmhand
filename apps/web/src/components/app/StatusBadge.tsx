import type { OperationStatus, PrinterLive, StepStatus } from "@farmhand/contracts";
import { cn } from "cn";

export type Tone = "ok" | "warn" | "bad" | "neutral" | "info";

const TONE: Record<Tone, string> = {
  ok: "border-success/30 bg-success/10 text-success",
  warn: "border-warning/30 bg-warning/10 text-warning",
  bad: "border-destructive/30 bg-destructive/10 text-destructive",
  info: "border-primary/30 bg-primary/10 text-primary",
  neutral: "border-border bg-muted text-muted-foreground",
};

/** Status is always a text label; the dot and color only repeat it. */
export function StatusBadge({ tone, label, className }: { tone: Tone; label: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2 text-xs font-medium whitespace-nowrap",
        TONE[tone],
        className,
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

export const connectionTone = (c: PrinterLive["connection"]): Tone =>
  c === "online" ? "ok" : c === "connecting" || c === "klippy_startup" ? "warn" : "bad";

export const jobTone = (s: NonNullable<PrinterLive["state"]>): Tone =>
  s === "printing"
    ? "info"
    : s === "paused"
      ? "warn"
      : s === "error"
        ? "bad"
        : s === "complete"
          ? "ok"
          : "neutral";

export const stepTone = (s: StepStatus): Tone =>
  s === "success" || s === "already_configured"
    ? "ok"
    : s === "failed"
      ? "bad"
      : s === "unknown"
        ? "warn"
        : "neutral";

export const appTone = (s: "up" | "down" | "unknown"): Tone =>
  s === "up" ? "ok" : s === "down" ? "bad" : "warn";

export const operationTone = (s: OperationStatus): Tone =>
  s === "complete" ? "ok" : s === "running" ? "info" : s === "partial" || s === "unknown" ? "warn" : "bad";
