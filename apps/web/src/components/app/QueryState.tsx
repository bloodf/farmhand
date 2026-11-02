import type { UseQueryResult } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { AlertTriangleIcon, RotateCwIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { StatusBadge } from "./StatusBadge";

export function useErrorText() {
  const { t } = useTranslation();
  return (err: unknown): string => {
    if (!(err instanceof ApiError)) return t("errors.network");
    const reason = (err.body as { reason?: unknown } | null)?.reason;
    if (err.code === "rejected" && typeof reason === "string") return reasonText(t, reason);
    return t(`errors.${err.code}`, { defaultValue: t("errors.generic", { status: err.status }) });
  };
}

/** Why a printer address was refused, from the server's reason code. */
export function reasonText(t: TFunction, reason: string): string {
  const http = /^http_(\d+)$/.exec(reason);
  if (http) return t("reasons.http", { status: http[1] });
  return t(`reasons.${reason}`, { defaultValue: t("reasons.other", { reason }) });
}

/** A source that failed: say so, with when it was last checked. Never render it as zero. */
export function Unavailable({ checkedAt, reason }: { checkedAt?: string | null; reason?: string | null }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1">
      <StatusBadge tone="bad" label={t("status.unavailable")} />
      {reason ? <p className="text-sm break-words text-muted-foreground">{reason}</p> : null}
      {checkedAt ? (
        <p className="text-xs text-muted-foreground">
          {t("common.checkedAt", { time: fmtDateTime(checkedAt) })}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Wraps any query: skeleton while loading, error with retry, empty state, and a stale
 * notice when a refetch failed but older data is still on screen.
 */
export function QueryState<T>({
  query,
  children,
  isEmpty,
  empty,
  skeleton,
}: {
  query: UseQueryResult<T>;
  children: (data: T) => ReactNode;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  skeleton?: ReactNode;
}) {
  const { t } = useTranslation();
  const errorText = useErrorText();

  if (query.isPending)
    return (
      <div role="status" aria-label={t("common.loading")}>
        {skeleton ?? (
          <div className="space-y-2">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-20 w-full" />
          </div>
        )}
      </div>
    );

  if (query.isError && query.data === undefined)
    return (
      <div
        role="alert"
        className="flex flex-col items-start gap-3 rounded-lg border border-destructive/30 p-4"
      >
        <div className="flex items-center gap-2">
          <AlertTriangleIcon aria-hidden className="size-4 text-destructive" />
          <p className="font-medium">{t("errors.loadFailed")}</p>
        </div>
        <p className="text-sm text-muted-foreground">{errorText(query.error)}</p>
        <Button variant="outline" onClick={() => query.refetch()} disabled={query.isFetching}>
          <RotateCwIcon aria-hidden />
          {query.isFetching ? t("common.retrying") : t("common.retry")}
        </Button>
      </div>
    );

  const data = query.data as T;
  return (
    <>
      {query.isError ? (
        <div
          role="status"
          className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-warning/30 bg-warning/5 p-2 text-sm"
        >
          <StatusBadge tone="warn" label={t("status.stale")} />
          <span className="text-muted-foreground">
            {t("common.lastUpdated", { time: fmtDateTime(new Date(query.dataUpdatedAt).toISOString()) })}
          </span>
          <Button variant="ghost" onClick={() => query.refetch()} disabled={query.isFetching}>
            {t("common.retry")}
          </Button>
        </div>
      ) : null}
      {isEmpty?.(data) && empty ? empty : children(data)}
    </>
  );
}
