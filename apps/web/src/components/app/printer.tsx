import { type PrinterLive, STEP_IDS } from "@farmhand/contracts";
import { useTranslation } from "react-i18next";
import { Progress } from "@/components/ui/progress";
import { fmtPercent, fmtTemp } from "@/lib/format";
import type { Printer } from "@/lib/types";
import { connectionTone, jobTone, StatusBadge, stepTone } from "./StatusBadge";

export function ConnectionBadge({ live }: { live: PrinterLive | null }) {
  const { t } = useTranslation();
  if (!live) return <StatusBadge tone="neutral" label={t("printer.noData")} />;
  return <StatusBadge tone={connectionTone(live.connection)} label={t(`connection.${live.connection}`)} />;
}

export function JobBadge({ live }: { live: PrinterLive | null }) {
  const { t } = useTranslation();
  if (!live?.state) return null;
  return <StatusBadge tone={jobTone(live.state)} label={t(`jobState.${live.state}`)} />;
}

export function StaleBadge({ live }: { live: PrinterLive | null }) {
  const { t } = useTranslation();
  return live?.stale ? <StatusBadge tone="warn" label={t("status.stale")} /> : null;
}

export function JobProgress({ live }: { live: PrinterLive | null }) {
  const { t } = useTranslation();
  if (live?.progress == null)
    return <span className="text-sm text-muted-foreground">{t("common.none")}</span>;
  return (
    <div className="flex min-w-28 items-center gap-2">
      <Progress value={live.progress * 100} aria-label={t("printer.progress")} className="flex-1" />
      <span className="text-sm tabular-nums">{fmtPercent(live.progress)}</span>
    </div>
  );
}

export function Temps({ live }: { live: PrinterLive | null }) {
  const { t } = useTranslation();
  const row = (key: "extruder" | "bed") => {
    const v = live?.temps[key];
    return (
      <span className="whitespace-nowrap">
        {t(`printer.${key}`)}{" "}
        <span className="tabular-nums">
          {v
            ? t("printer.tempPair", { actual: fmtTemp(v.actual), target: fmtTemp(v.target) })
            : t("common.none")}
        </span>
      </span>
    );
  };
  return (
    <div className="flex flex-col text-sm">
      {row("extruder")}
      {row("bed")}
    </div>
  );
}

export function IntegrationChips({ printer }: { printer: Printer }) {
  const { t } = useTranslation();
  return (
    <ul aria-label={t("printer.integrations")} className="flex flex-wrap gap-1">
      {STEP_IDS.map((id) => {
        const s = printer.integrations[id];
        return (
          <li key={id}>
            <StatusBadge
              tone={s ? stepTone(s.status) : "neutral"}
              label={`${t(`steps.${id}`)}: ${s ? t(`stepStatus.${s.status}`) : t("common.none")}`}
            />
          </li>
        );
      })}
    </ul>
  );
}
