import { SERVICE_LABELS } from "@farmhand/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PlusIcon, PrinterIcon, RadarIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/app/EmptyState";
import { Kpi } from "@/components/app/Kpi";
import { PageHeader } from "@/components/app/PageHeader";
import { QueryState, Unavailable } from "@/components/app/QueryState";
import { appTone, StatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtDateTime, fmtGrams, fmtNumber } from "@/lib/format";
import { q } from "@/lib/queries";
import type { Overview } from "@/lib/types";

export const Route = createFileRoute("/_app/")({
  staticData: { titleKey: "nav.overview" },
  component: OverviewPage,
});

function OverviewPage() {
  const { t } = useTranslation();
  const overview = useQuery(q.overview);
  return (
    <>
      <PageHeader
        title={t("overview.title")}
        description={
          overview.data ? t("common.lastUpdated", { time: fmtDateTime(overview.data.generatedAt) }) : null
        }
      />
      <QueryState
        query={overview}
        skeleton={
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {["a", "b", "c", "d"].map((k) => (
              <Skeleton key={k} className="h-24" />
            ))}
          </div>
        }
      >
        {(data) => <OverviewBody data={data} />}
      </QueryState>
    </>
  );
}

function OverviewBody({ data }: { data: Overview }) {
  const { t } = useTranslation();
  const p = data.printers;
  const noPrinters = p.approved === 0 && p.pending === 0;
  return (
    <div className="space-y-6">
      {noPrinters ? (
        <EmptyState
          icon={PrinterIcon}
          title={t("overview.empty.title")}
          description={t("overview.empty.description")}
          actions={
            <>
              <Button nativeButton={false} render={<Link to="/discover" />}>
                <RadarIcon aria-hidden />
                {t("overview.empty.discover")}
              </Button>
              <Button
                nativeButton={false}
                variant="outline"
                render={<Link to="/discover" search={{ add: 1 }} />}
              >
                <PlusIcon aria-hidden />
                {t("overview.empty.addByIp")}
              </Button>
            </>
          }
        />
      ) : (
        <section aria-label={t("overview.printersLabel")} className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi label={t("overview.kpi.approved")} value={fmtNumber(p.approved)} />
          <Kpi label={t("overview.kpi.printing")} value={fmtNumber(p.printing)} />
          <Kpi label={t("overview.kpi.offline")} value={fmtNumber(p.offline)} />
          <Kpi label={t("overview.kpi.pending")} value={fmtNumber(p.pending)} />
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <StockCard stock={data.stock} />
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{t("overview.apps")}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.apps.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("apps.none")}</p>
            ) : (
              <ul className="divide-y">
                {data.apps.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <p className="font-medium">{SERVICE_LABELS[a.id]}</p>
                      <p className="text-xs text-muted-foreground">
                        {t("common.checkedAt", { time: fmtDateTime(a.checkedAt) })}
                      </p>
                    </div>
                    <StatusBadge tone={appTone(a.status)} label={t(`appStatus.${a.status}`)} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StockCard({ stock }: { stock: Overview["stock"] }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t("overview.stock.title")}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {stock.source === "unavailable" ? (
          <Unavailable checkedAt={stock.checkedAt} reason={stock.error ?? t("overview.stock.unavailable")} />
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-3">
              <div>
                <dt className="text-sm text-muted-foreground">{t("overview.stock.spools")}</dt>
                <dd className="text-xl font-semibold tabular-nums">{fmtNumber(stock.spools)}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">{t("overview.stock.known")}</dt>
                <dd className="text-xl font-semibold tabular-nums">{fmtGrams(stock.knownGrams)}</dd>
              </div>
            </dl>
            {stock.spoolsWithoutWeight > 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("overview.stock.withoutWeight", { count: stock.spoolsWithoutWeight })}
              </p>
            ) : null}
            <div className="space-y-2">
              <h3 className="text-sm font-medium">{t("overview.stock.low")}</h3>
              {stock.lowStock.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("overview.stock.lowNone")}</p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {stock.lowStock.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 p-2 text-sm">
                      <span className="min-w-0 break-words">
                        {s.name}
                        {s.material ? <span className="text-muted-foreground"> · {s.material}</span> : null}
                      </span>
                      <StatusBadge
                        tone="warn"
                        label={t("overview.stock.left", { amount: fmtGrams(s.remainingGrams) })}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {stock.byMaterial.length > 0 ? (
              <div className="space-y-2">
                <h3 className="text-sm font-medium">{t("overview.stock.byMaterial")}</h3>
                <ul className="divide-y rounded-md border text-sm">
                  {stock.byMaterial.map((m) => (
                    <li key={m.material ?? "none"} className="flex flex-wrap justify-between gap-2 p-2">
                      <span>{m.material ?? t("overview.stock.noMaterial")}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {m.knownGrams === 0 && m.spoolsWithoutWeight > 0
                          ? t("overview.stock.materialLineUnknown", { spools: m.spools })
                          : t("overview.stock.materialLine", {
                              spools: m.spools,
                              amount: fmtGrams(m.knownGrams),
                            })}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground">
              {t("common.checkedAt", { time: fmtDateTime(stock.checkedAt) })}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
