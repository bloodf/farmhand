import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronDownIcon, ChevronRightIcon, HistoryIcon } from "lucide-react";
import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/app/EmptyState";
import { PageHeader } from "@/components/app/PageHeader";
import { QueryState } from "@/components/app/QueryState";
import { operationTone, StatusBadge } from "@/components/app/StatusBadge";
import { StepList } from "@/components/app/StepList";
import { Button } from "@/components/ui/button";
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
  const [open, setOpen] = useState<string | null>(null);
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
                  <Fragment key={op.id}>
                    <TableRow>
                      <TableCell className="font-medium">
                        <Button
                          variant="ghost"
                          className="-ml-2"
                          aria-expanded={open === op.id}
                          aria-controls={`op-${op.id}`}
                          onClick={() => setOpen(open === op.id ? null : op.id)}
                        >
                          {open === op.id ? (
                            <ChevronDownIcon aria-hidden />
                          ) : (
                            <ChevronRightIcon aria-hidden />
                          )}
                          {t(`operationKind.${op.kind}`)}
                        </Button>
                      </TableCell>
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
                    {open === op.id ? (
                      <TableRow id={`op-${op.id}`}>
                        <TableCell colSpan={5} className="whitespace-normal">
                          {/* Sticky and capped to the viewport so it stays readable while the table scrolls sideways. */}
                          <div className="sticky left-2 w-[calc(100vw-4rem)] max-w-full space-y-3">
                            {op.steps.length ? (
                              <StepList steps={op.steps} />
                            ) : (
                              <p className="text-sm text-muted-foreground">{t("operations.noSteps")}</p>
                            )}
                            <div className="space-y-1">
                              <p className="text-sm font-medium">{t("operations.input")}</p>
                              <pre className="overflow-x-auto rounded-md border bg-muted p-3 font-mono text-xs">
                                {Object.keys(op.input).length
                                  ? JSON.stringify(op.input, null, 2)
                                  : t("common.none")}
                              </pre>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </QueryState>
    </>
  );
}
