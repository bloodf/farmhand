import type { AppId } from "@farmhand/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AppWindowIcon, ExternalLinkIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/app/EmptyState";
import { PageHeader } from "@/components/app/PageHeader";
import { QueryState } from "@/components/app/QueryState";
import { appTone, StatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtDateTime } from "@/lib/format";
import { useLive } from "@/lib/live";
import { q } from "@/lib/queries";

const PUBLIC_URL_VAR: Record<AppId, string> = {
  printstash: "PRINTSTASH_PUBLIC_URL",
  spoolman: "SPOOLMAN_PUBLIC_URL",
  "fdm-monster": "FDM_PUBLIC_URL",
  orcaslicer: "ORCASLICER_PUBLIC_URL",
};

export const Route = createFileRoute("/_app/apps")({
  staticData: { titleKey: "nav.apps" },
  component: AppsPage,
});

function AppsPage() {
  const { t } = useTranslation();
  const apps = useQuery(q.apps);
  const liveApps = useLive().data?.apps;
  return (
    <>
      <PageHeader title={t("apps.title")} description={t("apps.description")} />
      <QueryState
        query={apps}
        isEmpty={(items) => items.length === 0}
        empty={<EmptyState icon={AppWindowIcon} title={t("apps.none")} />}
      >
        {(items) => (
          <ul className="grid gap-4 sm:grid-cols-2">
            {items.map((app) => {
              const health = liveApps?.find((h) => h.id === app.id) ?? app.health;
              return (
                <li key={app.id}>
                  <Card className="h-full">
                    <CardHeader>
                      <CardTitle>
                        <h2>{app.label}</h2>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1">
                      <StatusBadge tone={appTone(health.status)} label={t(`appStatus.${health.status}`)} />
                      {health.error ? (
                        <p className="text-sm break-words text-muted-foreground">{health.error}</p>
                      ) : null}
                      <p className="text-xs text-muted-foreground">
                        {t("common.checkedAt", { time: fmtDateTime(health.checkedAt) })}
                      </p>
                    </CardContent>
                    <CardFooter>
                      {app.url ? (
                        <Button
                          variant="outline"
                          render={<a href={app.url} target="_blank" rel="noopener noreferrer" />}
                        >
                          <ExternalLinkIcon aria-hidden />
                          {t("apps.open", { app: app.label })}
                        </Button>
                      ) : (
                        <div className="space-y-1">
                          <StatusBadge tone="neutral" label={t("apps.notConfigured")} />
                          <p className="text-xs text-muted-foreground">
                            {t("apps.publicUrlHint", { variable: PUBLIC_URL_VAR[app.id] })}
                          </p>
                        </div>
                      )}
                    </CardFooter>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </QueryState>
    </>
  );
}
