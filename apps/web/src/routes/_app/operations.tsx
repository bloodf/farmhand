import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { HistoryIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/app/EmptyState";
import { PageHeader } from "@/components/app/PageHeader";
import { QueryState } from "@/components/app/QueryState";
import { operationTone, StatusBadge } from "@/components/app/StatusBadge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDateTime } from "@/lib/format";
import { q } from "@/lib/queries";

export const Route = createFileRoute("/_app/operations")({
  staticData: { titleKey: "nav.operations" },
  component: OperationsPage,
});

function OperationsPage() {
  const { t } = useTranslation();
  const ops = useQuery(q.operations);
  return (
    <>
      <PageHeader title={t("operations.title")} description={t("operations.description")} />
      <QueryState
        query={ops}
        isEmpty={(items) => items.length === 0}
        empty={<EmptyState icon={HistoryIcon} title={t("operations.empty")} />}
      >
        {(items) => (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("operations.col.kind")}</TableHead>
                  <TableHead>{t("operations.col.target")}</TableHead>
                  <TableHead>{t("operations.col.status")}</TableHead>
                  <TableHead>{t("operations.col.started")}</TableHead>
                  <TableHead>{t("operations.col.finished")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((op) => (
                  <TableRow key={op.id}>
                    <TableCell className="font-medium">{t(`operationKind.${op.kind}`)}</TableCell>
                    <TableCell className="font-mono text-xs">{op.target ?? t("common.none")}</TableCell>
                    <TableCell>
                      <StatusBadge
                        tone={operationTone(op.status)}
                        label={t(`operationStatus.${op.status}`)}
                      />
                    </TableCell>
                    <TableCell>{fmtDateTime(op.startedAt)}</TableCell>
                    <TableCell>{op.finishedAt ? fmtDateTime(op.finishedAt) : t("common.none")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </QueryState>
    </>
  );
}
