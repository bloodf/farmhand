import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PlusIcon, PrinterIcon, RadarIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/app/EmptyState";
import { PageHeader } from "@/components/app/PageHeader";
import {
  ConnectionBadge,
  IntegrationChips,
  JobBadge,
  JobProgress,
  StaleBadge,
  Temps,
} from "@/components/app/printer";
import { QueryState } from "@/components/app/QueryState";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useLive } from "@/lib/live";
import { q } from "@/lib/queries";

export const Route = createFileRoute("/_app/printers/")({
  staticData: { titleKey: "nav.printers" },
  component: PrintersPage,
});

function PrintersPage() {
  const { t } = useTranslation();
  const printers = useQuery(q.printers);
  const live = useLive().data;

  return (
    <>
      <PageHeader
        title={t("printers.title")}
        actions={
          <Button nativeButton={false} variant="outline" render={<Link to="/discover" />}>
            <RadarIcon aria-hidden />
            {t("printers.discover")}
          </Button>
        }
      />
      <QueryState
        query={printers}
        isEmpty={(items) => items.length === 0}
        empty={
          <EmptyState
            icon={PrinterIcon}
            title={t("overview.empty.title")}
            description={t("overview.empty.description")}
            actions={
              <>
                <Button nativeButton={false} render={<Link to="/discover" />}>
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
        }
      >
        {(items) => {
          const rows = items.map((p) => ({ p, l: live?.printers.get(p.id) ?? p.live }));
          return (
            <>
              {/* Desktop: table */}
              <div className="hidden rounded-lg border md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("printers.col.name")}</TableHead>
                      <TableHead>{t("printers.col.status")}</TableHead>
                      <TableHead>{t("printers.col.progress")}</TableHead>
                      <TableHead>{t("printers.col.temps")}</TableHead>
                      <TableHead>{t("printers.col.integrations")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map(({ p, l }) => (
                      <TableRow key={p.id}>
                        <TableCell>
                          <Link
                            to="/printers/$id"
                            params={{ id: p.id }}
                            className="font-medium underline-offset-4 hover:underline"
                          >
                            {p.name}
                          </Link>
                          <p className="font-mono text-xs text-muted-foreground">
                            {p.host}:{p.port}
                          </p>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            <ConnectionBadge live={l} />
                            <JobBadge live={l} />
                            <StaleBadge live={l} />
                          </div>
                        </TableCell>
                        <TableCell>
                          <JobProgress live={l} />
                        </TableCell>
                        <TableCell>
                          <Temps live={l} />
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          <IntegrationChips printer={p} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {/* Mobile: cards */}
              <ul className="space-y-3 md:hidden">
                {rows.map(({ p, l }) => (
                  <li key={p.id}>
                    <Link
                      to="/printers/$id"
                      params={{ id: p.id }}
                      className="block space-y-3 rounded-lg border bg-card p-4 hover:bg-muted/50"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium break-words">{p.name}</p>
                          <p className="font-mono text-xs break-all text-muted-foreground">
                            {p.host}:{p.port}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          <ConnectionBadge live={l} />
                          <JobBadge live={l} />
                          <StaleBadge live={l} />
                        </div>
                      </div>
                      <JobProgress live={l} />
                      <Temps live={l} />
                      <IntegrationChips printer={p} />
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          );
        }}
      </QueryState>
    </>
  );
}
