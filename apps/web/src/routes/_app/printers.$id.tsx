import { STEP_IDS, type Step } from "@farmhand/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { RotateCwIcon, StethoscopeIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { KlippyBadge } from "@/components/app/ApproveWizard";
import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import { CopyBlock } from "@/components/app/CopyBlock";
import { PageHeader } from "@/components/app/PageHeader";
import { ConnectionBadge, JobBadge, JobProgress, StaleBadge, Temps } from "@/components/app/printer";
import { QueryState, reasonText, useErrorText } from "@/components/app/QueryState";
import { StatusBadge } from "@/components/app/StatusBadge";
import { StepList } from "@/components/app/StepList";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchJson } from "@/lib/api";
import { fmtDateTime, fmtDuration } from "@/lib/format";
import { useLive } from "@/lib/live";
import { q } from "@/lib/queries";
import { useHasRole } from "@/lib/session";
import type { Identity, Printer } from "@/lib/types";

export const Route = createFileRoute("/_app/printers/$id")({
  staticData: { titleKey: "printer.title" },
  component: PrinterPage,
});

function PrinterPage() {
  const { id } = Route.useParams();
  const printer = useQuery(q.printer(id));
  return <QueryState query={printer}>{(p) => <PrinterDetail printer={p} />}</QueryState>;
}

interface Diagnostics {
  checkedAt: string;
  moonraker: { ok: true; identity: Identity } | { ok: false; error: string };
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
  const qc = useQueryClient();
  const errorText = useErrorText();
  const canOperate = useHasRole("operator");
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const [confirmRepair, setConfirmRepair] = useState(false);
  const [repaired, setRepaired] = useState<Step[] | null>(null);
  const steps = STEP_IDS.map((id) => ({
    id,
    status: p.integrations[id]?.status ?? "unknown",
    message: p.integrations[id]?.message ?? "",
    checkedAt: p.integrations[id]?.checkedAt,
  }));
  const failing = steps.filter((s) => s.status === "failed" || s.status === "unknown");
  const refresh = () => qc.invalidateQueries({ queryKey: q.printer(p.id).queryKey });

  const diagnose = async () => {
    setDiagnosing(true);
    try {
      setDiag(
        await fetchJson<Diagnostics>(`/printers/${encodeURIComponent(p.id)}/diagnostics`, { method: "POST" }),
      );
      await refresh();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setDiagnosing(false);
    }
  };

  const repair = async () => {
    try {
      const r = await fetchJson<{ steps: Step[] }>(`/printers/${encodeURIComponent(p.id)}/repair`, {
        method: "POST",
        json: { confirm: true },
      });
      setRepaired(r.steps);
      await refresh();
    } catch (err) {
      toast.error(errorText(err));
      throw err;
    }
  };

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
          canOperate ? (
            <>
              <Button variant="outline" onClick={diagnose} disabled={diagnosing}>
                <StethoscopeIcon aria-hidden />
                {diagnosing ? t("printer.diagnosing") : t("printer.diagnostics")}
              </Button>
              {failing.length ? (
                <Button variant="outline" onClick={() => setConfirmRepair(true)}>
                  <RotateCwIcon aria-hidden />
                  {t("printer.retryFailed")}
                </Button>
              ) : null}
            </>
          ) : null
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
          <CardContent className="space-y-4">
            {diag ? (
              <div role="status" className="space-y-2 rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{t("printer.diag.title")}</p>
                  <StatusBadge
                    tone={diag.moonraker.ok ? "ok" : "bad"}
                    label={diag.moonraker.ok ? t("printer.diag.reachable") : t("printer.diag.unreachable")}
                  />
                </div>
                {diag.moonraker.ok ? (
                  <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
                    <span>
                      {t("discover.moonraker", { version: diag.moonraker.identity.moonrakerVersion })}
                    </span>
                    <KlippyBadge state={diag.moonraker.identity.klippyState} />
                  </div>
                ) : (
                  <p className="text-muted-foreground">{reasonText(t, diag.moonraker.error)}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  {t("common.checkedAt", { time: fmtDateTime(diag.checkedAt) })}
                </p>
              </div>
            ) : null}
            {repaired ? (
              <div className="space-y-2">
                <p className="text-sm font-medium">{t("printer.repairResult")}</p>
                <StepList steps={repaired} />
              </div>
            ) : null}
            <StepList steps={steps} />
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={confirmRepair}
        onOpenChange={setConfirmRepair}
        title={t("printer.repairTitle", { name: p.name })}
        effects={[
          t("printer.repairEffect", { steps: failing.map((s) => t(`steps.${s.id}`)).join(", ") }),
          t("printer.repairKeep"),
        ]}
        confirmLabel={t("printer.retryFailed")}
        onConfirm={repair}
      />

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
