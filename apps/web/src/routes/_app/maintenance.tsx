import type { LogSource } from "@farmhand/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ArchiveIcon, RotateCwIcon, ScrollTextIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import { CopyBlock } from "@/components/app/CopyBlock";
import { PageHeader } from "@/components/app/PageHeader";
import { QueryState, useErrorText } from "@/components/app/QueryState";
import { StatusBadge, type Tone } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { fetchJson } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { q } from "@/lib/queries";
import { useHasRole } from "@/lib/session";
import type { ServiceRow } from "@/lib/types";

export const Route = createFileRoute("/_app/maintenance")({
  staticData: { titleKey: "nav.maintenance" },
  component: MaintenancePage,
});

const STATE_TONE: Record<ServiceRow["state"], Tone> = {
  running: "ok",
  exited: "bad",
  missing: "bad",
  unknown: "warn",
};
const HEALTH_TONE: Record<ServiceRow["health"], Tone> = {
  healthy: "ok",
  unhealthy: "bad",
  starting: "warn",
  none: "neutral",
};
const BACKUP_POLL_MS = 3000;
const BACKUP_BUSY = new Set(["active", "activating", "deactivating", "reloading"]);

function MaintenancePage() {
  const { t } = useTranslation();
  const services = useQuery(q.services);
  const canOperate = useHasRole("operator");
  const [logs, setLogs] = useState<{ source: LogSource; label: string } | null>(null);

  return (
    <>
      <PageHeader title={t("maintenance.title")} description={t("maintenance.description")} />
      <section aria-labelledby="m-services" className="space-y-3">
        <h2 id="m-services" className="font-medium">
          {t("maintenance.services.title")}
        </h2>
        <QueryState query={services}>
          {(s) => (
            <div className="space-y-3">
              {s.helper === "fake" ? (
                <p role="note" className="rounded-md border border-dashed p-3 text-sm">
                  {t("maintenance.fakeHelper")}
                </p>
              ) : null}
              <ul className="divide-y rounded-lg border">
                {s.items.map((svc) => (
                  <ServiceItem
                    key={svc.id}
                    service={svc}
                    canOperate={canOperate}
                    onLogs={() => setLogs({ source: svc.id, label: svc.label })}
                  />
                ))}
                <li className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium">{t("maintenance.guard")}</p>
                    <StatusBadge
                      tone={s.guard === "active" ? "ok" : "warn"}
                      label={t(`unitState.${s.guard}`, { defaultValue: s.guard })}
                    />
                  </div>
                  {canOperate ? (
                    <Button
                      variant="outline"
                      onClick={() => setLogs({ source: "guard", label: t("maintenance.guard") })}
                    >
                      <ScrollTextIcon aria-hidden />
                      {t("maintenance.logs.open")}
                    </Button>
                  ) : null}
                </li>
              </ul>
            </div>
          )}
        </QueryState>
      </section>
      <BackupCard />
      <LogSheet target={logs} onClose={() => setLogs(null)} />
    </>
  );
}

function ServiceItem({
  service: s,
  canOperate,
  onLogs,
}: {
  service: ServiceRow;
  canOperate: boolean;
  onLogs: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const errorText = useErrorText();
  const [confirming, setConfirming] = useState(false);

  const restart = async () => {
    try {
      const r = await fetchJson<{ ready: boolean; state: string }>(`/services/${s.id}/restart`, {
        method: "POST",
        json: { confirm: true },
      });
      const state = t(`serviceState.${r.state}`, { defaultValue: r.state });
      if (r.ready) toast.success(t("maintenance.restart.ready", { service: s.label, state }));
      else toast.warning(t("maintenance.restart.notReady", { service: s.label, state }));
    } catch (err) {
      toast.error(errorText(err));
      throw err;
    } finally {
      void qc.invalidateQueries({ queryKey: q.services.queryKey });
      void qc.invalidateQueries({ queryKey: q.operations.queryKey });
    }
  };

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 p-3">
      <div className="min-w-0 space-y-1">
        <p className="font-medium">{s.label}</p>
        <div className="flex flex-wrap gap-1">
          <StatusBadge tone={STATE_TONE[s.state]} label={t(`serviceState.${s.state}`)} />
          <StatusBadge tone={HEALTH_TONE[s.health]} label={t(`serviceHealth.${s.health}`)} />
        </div>
      </div>
      {canOperate ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onLogs}>
            <ScrollTextIcon aria-hidden />
            {t("maintenance.logs.open")}
          </Button>
          <Button variant="outline" onClick={() => setConfirming(true)}>
            <RotateCwIcon aria-hidden />
            {t("maintenance.restart.button")}
          </Button>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("maintenance.restart.title", { service: s.label })}
        effects={[t("maintenance.restart.effect"), t("maintenance.restart.prints")]}
        confirmLabel={t("maintenance.restart.button")}
        onConfirm={restart}
      />
    </li>
  );
}

function LogSheet({
  target,
  onClose,
}: {
  target: { source: LogSource; label: string } | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const logs = useQuery({ ...q.logs(target?.source ?? "guard"), enabled: target !== null });
  return (
    <Sheet open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        showCloseButton={false}
        className="overflow-y-auto p-4 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl"
      >
        <SheetHeader className="p-0">
          <SheetTitle>{t("maintenance.logs.title", { source: target?.label ?? "" })}</SheetTitle>
          <SheetDescription>
            {logs.data
              ? t("maintenance.logs.fetched", { time: fmtDateTime(logs.data.fetchedAt) })
              : t("maintenance.logs.hint")}
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => logs.refetch()} disabled={logs.isFetching}>
            <RotateCwIcon aria-hidden />
            {logs.isFetching ? t("common.working") : t("maintenance.logs.refresh")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.close")}
          </Button>
        </div>
        {target ? (
          <QueryState query={logs}>
            {(l) =>
              l.lines.length ? (
                <CopyBlock
                  label={t("maintenance.logs.lines", { count: l.lines.length })}
                  value={l.lines.join("\n")}
                />
              ) : (
                <p className="text-sm text-muted-foreground">{t("maintenance.logs.empty")}</p>
              )
            }
          </QueryState>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function BackupCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const errorText = useErrorText();
  const isAdmin = useHasRole("admin");
  const [confirming, setConfirming] = useState(false);
  const status = useQuery({
    ...q.backupStatus,
    refetchInterval: (query) =>
      BACKUP_BUSY.has(query.state.data?.activeState ?? "") ? BACKUP_POLL_MS : false,
  });
  const active = BACKUP_BUSY.has(status.data?.activeState ?? "");

  const start = async () => {
    try {
      await fetchJson("/backups", { method: "POST", json: { confirm: true } });
      toast.success(t("maintenance.backup.started"));
    } catch (err) {
      toast.error(errorText(err));
      throw err;
    } finally {
      void qc.invalidateQueries({ queryKey: q.backupStatus.queryKey });
    }
  };

  return (
    <section aria-labelledby="m-backup">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id="m-backup">{t("maintenance.backup.title")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <QueryState query={status}>
            {(b) => (
              <dl className="divide-y text-sm">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
                  <dt className="text-muted-foreground">{t("maintenance.backup.state")}</dt>
                  <dd>
                    <StatusBadge
                      tone={active ? "info" : b.activeState === "failed" ? "bad" : "neutral"}
                      label={t(`unitState.${b.activeState}`, { defaultValue: b.activeState })}
                    />
                  </dd>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
                  <dt className="text-muted-foreground">{t("maintenance.backup.result")}</dt>
                  <dd>
                    {b.result ? (
                      <StatusBadge
                        tone={b.result === "success" ? "ok" : "bad"}
                        label={t(`unitResult.${b.result}`, { defaultValue: b.result })}
                      />
                    ) : (
                      t("common.none")
                    )}
                  </dd>
                </div>
                <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2">
                  <dt className="text-muted-foreground">{t("maintenance.backup.startedAt")}</dt>
                  <dd>{b.startedAt ? fmtDateTime(b.startedAt) : t("common.none")}</dd>
                </div>
                <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2">
                  <dt className="text-muted-foreground">{t("maintenance.backup.finishedAt")}</dt>
                  <dd>{b.finishedAt ? fmtDateTime(b.finishedAt) : t("common.none")}</dd>
                </div>
              </dl>
            )}
          </QueryState>
        </CardContent>
        {isAdmin ? (
          <CardFooter>
            <Button onClick={() => setConfirming(true)} disabled={active}>
              <ArchiveIcon aria-hidden />
              {active ? t("maintenance.backup.running") : t("maintenance.backup.run")}
            </Button>
          </CardFooter>
        ) : null}
      </Card>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("maintenance.backup.confirmTitle")}
        effects={[t("maintenance.backup.effect"), t("maintenance.backup.limit")]}
        confirmLabel={t("maintenance.backup.run")}
        onConfirm={start}
      />
    </section>
  );
}
