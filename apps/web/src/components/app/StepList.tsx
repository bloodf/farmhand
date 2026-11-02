import type { StepId, StepStatus } from "@farmhand/contracts";
import { useTranslation } from "react-i18next";
import { fmtDateTime } from "@/lib/format";
import { StatusBadge, stepTone } from "./StatusBadge";

export interface StepRow {
  id: StepId;
  status: StepStatus;
  message: string;
  checkedAt?: string | null;
}

export function StepList({ steps }: { steps: StepRow[] }) {
  const { t } = useTranslation();
  return (
    <ul className="divide-y rounded-lg border">
      {steps.map((s) => (
        <li key={s.id} className="flex flex-wrap items-start justify-between gap-2 p-3">
          <div className="min-w-0 space-y-0.5">
            <p className="font-medium">{t(`steps.${s.id}`)}</p>
            {s.message ? <p className="text-sm break-words text-muted-foreground">{s.message}</p> : null}
            {s.checkedAt ? (
              <p className="text-xs text-muted-foreground">
                {t("common.checkedAt", { time: fmtDateTime(s.checkedAt) })}
              </p>
            ) : null}
          </div>
          <StatusBadge tone={stepTone(s.status)} label={t(`stepStatus.${s.status}`)} />
        </li>
      ))}
    </ul>
  );
}
