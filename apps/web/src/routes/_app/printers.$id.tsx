import { STEP_IDS } from "@farmhand/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { RotateCwIcon, StethoscopeIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CopyBlock } from "@/components/app/CopyBlock";
import { PageHeader } from "@/components/app/PageHeader";
import { ConnectionBadge, JobBadge, JobProgress, StaleBadge, Temps } from "@/components/app/printer";
import { QueryState } from "@/components/app/QueryState";
import { StepList } from "@/components/app/StepList";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fmtDateTime, fmtDuration } from "@/lib/format";
import { useLive } from "@/lib/live";
import { q } from "@/lib/queries";
import type { Printer } from "@/lib/types";

export const Route = createFileRoute("/_app/printers/$id")({
  staticData: { titleKey: "printer.title" },
  component: PrinterPage,
});

function PrinterPage() {
  const { id } = Route.useParams();
  const printer = useQuery(q.printer(id));
  return <QueryState query={printer}>{(p) => <PrinterDetail printer={p} />}</QueryState>;
}

function SoonButton({ icon, label }: { icon: ReactNode; label: string }) {
  const { t } = useTranslation();
  // focusableWhenDisabled keeps the button reachable so the tooltip can explain why it is off.
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="outline" disabled focusableWhenDisabled />}>
        {icon}
        {label}
      </TooltipTrigger>
      <TooltipContent>{t("common.comingSoon")}</TooltipContent>
    </Tooltip>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm break-words">{children}</dd>
    </div>
  );
}

function PrinterDetail({ printer: p }: { printer: Printer }) {
  const { t } = useTranslation();
  const live = useLive().data?.printers.get(p.id) ?? p.live;
  const snippets = useQuery(q.snippets(p.id));

  return (
    <>
      <PageHeader
        title={p.name}
        description={
          <span className="flex flex-wrap gap-x-3">
            <span className="font-mono">
              {p.host}:{p.port}
            </span>
            <span>{t(`printerSource.${p.source}`)}</span>
            <span>{t("printer.approvedAt", { time: fmtDateTime(p.approvedAt) })}</span>
          </span>
        }
        actions={
          <>
            <SoonButton icon={<StethoscopeIcon aria-hidden />} label={t("printer.diagnostics")} />
            <SoonButton icon={<RotateCwIcon aria-hidden />} label={t("printer.retryFailed")} />
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{t("printer.live")}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1 pb-2">
              <ConnectionBadge live={live} />
              <JobBadge live={live} />
              <StaleBadge live={live} />
            </div>
            <dl className="divide-y">
              <Row label={t("printer.file")}>
                <span className="font-mono break-all">{live?.filename ?? t("common.none")}</span>
              </Row>
              <Row label={t("printer.progress")}>
                <JobProgress live={live} />
              </Row>
              <Row label={t("printer.duration")}>
                {live?.printDurationS != null ? fmtDuration(live.printDurationS) : t("common.none")}
              </Row>
              <Row label={t("printer.temps")}>
                <Temps live={live} />
              </Row>
              {live?.message ? <Row label={t("printer.message")}>{live.message}</Row> : null}
              <Row label={t("printer.updatedAt")}>
                {live ? fmtDateTime(live.updatedAt) : t("common.none")}
              </Row>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{t("printer.integrations")}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <StepList
              steps={STEP_IDS.map((id) => ({
                id,
                status: p.integrations[id]?.status ?? "unknown",
                message: p.integrations[id]?.message ?? "",
                checkedAt: p.integrations[id]?.checkedAt,
              }))}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("snippets.title")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <QueryState query={snippets}>
            {(s) => (
              <div className="space-y-6">
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">{t("snippets.spoolmanHelp")}</p>
                  {s.spoolmanConf ? (
                    <CopyBlock label={t("snippets.spoolman")} value={s.spoolmanConf} />
                  ) : (
                    <p className="rounded-md border border-dashed p-3 text-sm">{t("snippets.noLanIp")}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">{t("snippets.mobilerakerHelp")}</p>
                  <CopyBlock label={t("snippets.websocket")} value={s.websocketUrl} />
                </div>
                <CopyBlock label={t("snippets.moonraker")} value={s.moonrakerUrl} />
                <div className="space-y-2">
                  <h3 className="text-sm font-medium">{t("snippets.haTitle")}</h3>
                  <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                    <li>{t("snippets.haStep1")}</li>
                    <li>{t("snippets.haStep2", { url: s.moonrakerUrl })}</li>
                    <li>{t("snippets.haStep3")}</li>
                  </ol>
                </div>
              </div>
            )}
          </QueryState>
        </CardContent>
      </Card>
    </>
  );
}
