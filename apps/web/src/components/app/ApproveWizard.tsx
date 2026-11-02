import { nameProblem, type Step, type StepId } from "@farmhand/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { LoaderCircleIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ApiError, fetchJson } from "@/lib/api";
import type { Effect, Identity } from "@/lib/types";
import { Field } from "./AuthLayout";
import { QueryState, useErrorText } from "./QueryState";
import { StatusBadge, type Tone } from "./StatusBadge";
import { StepList } from "./StepList";

export interface ApproveTarget {
  ip: string;
  port: number;
  name?: string;
}

interface Preview {
  printer: { host: string; port: number; name: string; url: string; identity: Identity };
  effects: Effect[];
  confirmToken: string;
  expiresAt: string;
}

const WILL_DO_TONE: Record<Effect["willDo"], Tone> = { add: "info", already: "ok", unknown: "warn" };

const isBad = (s: Step) => s.status === "failed" || s.status === "unknown";

/** Check → apply → done. The dialog stays open while the server works. */
export function ApproveWizard({ target, onClose }: { target: ApproveTarget | null; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
      >
        {target ? (
          <Wizard key={`${target.ip}:${target.port}`} target={target} onClose={onClose} setBusy={setBusy} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Wizard({
  target,
  onClose,
  setBusy,
}: {
  target: ApproveTarget;
  onClose: () => void;
  setBusy: (busy: boolean) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const errorText = useErrorText();
  const [checkedName, setCheckedName] = useState(target.name);
  const [name, setName] = useState(target.name ?? "");
  const [phase, setPhase] = useState<"check" | "apply" | "done">("check");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ printerId: string; steps: Step[] } | null>(null);
  const [repairing, setRepairing] = useState(false);

  // A preview mints a single-use token, so it is never cached or shared.
  const preview = useQuery({
    queryKey: ["approval-preview", target.ip, target.port, checkedName],
    queryFn: async () => {
      const p = await fetchJson<Preview>("/approvals/preview", {
        method: "POST",
        json: { ip: target.ip, port: target.port, ...(checkedName ? { name: checkedName } : {}) },
      });
      setName(p.printer.name);
      return p;
    },
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const nameError = nameProblem(name);
  const renamed = preview.data !== undefined && name !== preview.data.printer.name;

  const apply = async (p: Preview) => {
    setPhase("apply");
    setBusy(true);
    setError(null);
    try {
      const r = await fetchJson<{ operationId: string; printerId: string; steps: Step[] }>("/approvals", {
        method: "POST",
        json: {
          confirmToken: p.confirmToken,
          host: p.printer.host,
          port: p.printer.port,
          name: p.printer.name,
        },
      });
      setResult(r);
      setPhase("done");
      for (const key of [["printers"], ["candidates"], ["overview"], ["operations"]])
        void qc.invalidateQueries({ queryKey: key });
    } catch (err) {
      setPhase("check");
      setError(err instanceof ApiError && err.code === "bad_token" ? t("approve.expired") : errorText(err));
      // The server spends the token on every attempt, so fetch a fresh one.
      void preview.refetch();
    } finally {
      setBusy(false);
    }
  };

  const repair = async (printerId: string, steps: Step[]) => {
    setRepairing(true);
    setBusy(true);
    setError(null);
    try {
      const r = await fetchJson<{ steps: Step[] }>(`/printers/${encodeURIComponent(printerId)}/repair`, {
        method: "POST",
        json: { confirm: true },
      });
      const rerun = new Map(r.steps.map((s) => [s.id, s]));
      setResult({ printerId, steps: steps.map((s) => rerun.get(s.id) ?? s) });
      void qc.invalidateQueries({ queryKey: ["printers"] });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setRepairing(false);
      setBusy(false);
    }
  };

  const stepNames = (ids: StepId[]) => ids.map((id) => t(`steps.${id}`)).join(", ");
  const errorLine = error ? (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  ) : null;

  if (phase === "apply")
    return (
      <>
        <DialogHeader>
          <DialogTitle>{t("approve.applyTitle")}</DialogTitle>
          <DialogDescription>{t("approve.applyHint")}</DialogDescription>
        </DialogHeader>
        <p role="status" className="flex items-center gap-2 text-sm">
          <LoaderCircleIcon aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
          {t("approve.applying")}
        </p>
      </>
    );

  if (phase === "done" && result) {
    const failed = result.steps.filter(isBad);
    const openPrinter = (
      <Button
        nativeButton={false}
        variant={failed.length ? "outline" : "default"}
        render={<Link to="/printers/$id" params={{ id: result.printerId }} />}
        onClick={onClose}
      >
        {t("approve.openPrinter")}
      </Button>
    );
    return (
      <>
        <DialogHeader>
          <DialogTitle>{failed.length ? t("approve.partialTitle") : t("approve.doneTitle")}</DialogTitle>
          <DialogDescription>
            {failed.length
              ? t("approve.failedSteps", { steps: stepNames(failed.map((s) => s.id)) })
              : t("approve.doneHint")}
          </DialogDescription>
        </DialogHeader>
        <StepList steps={result.steps} />
        {failed.length === 0 ? (
          <div className="space-y-1">
            <p className="text-sm font-medium">{t("approve.next.title")}</p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              <li>{t("approve.next.spoolman")}</li>
              <li>{t("approve.next.mobileraker")}</li>
              <li>{t("approve.next.ha")}</li>
            </ul>
          </div>
        ) : null}
        {errorLine}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={repairing}>
            {t("common.close")}
          </Button>
          {openPrinter}
          {failed.length ? (
            <Button onClick={() => repair(result.printerId, result.steps)} disabled={repairing}>
              {repairing ? t("common.working") : t("printer.retryFailed")}
            </Button>
          ) : null}
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("approve.title")}</DialogTitle>
        <DialogDescription>{t("approve.checkHint")}</DialogDescription>
      </DialogHeader>
      {errorLine}
      <QueryState query={preview}>
        {(p) => (
          <div className="space-y-4">
            <Field
              id="approve-name"
              label={t("fields.printerName")}
              error={nameError ? t(`validation.name.${nameError}`) : null}
              hint={renamed ? t("approve.renameHint") : undefined}
            >
              <Input
                id="approve-name"
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={nameError ? true : undefined}
              />
            </Field>
            <dl className="divide-y rounded-lg border text-sm">
              <div className="flex flex-wrap justify-between gap-x-4 p-3">
                <dt className="text-muted-foreground">{t("approve.address")}</dt>
                <dd className="font-mono break-all">
                  {p.printer.host}:{p.printer.port}
                </dd>
              </div>
              <div className="flex flex-wrap justify-between gap-x-4 p-3">
                <dt className="text-muted-foreground">{t("approve.moonraker")}</dt>
                <dd className="break-all">{p.printer.identity.moonrakerVersion}</dd>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-4 p-3">
                <dt className="text-muted-foreground">{t("approve.klipper")}</dt>
                <dd>
                  <KlippyBadge state={p.printer.identity.klippyState} />
                </dd>
              </div>
            </dl>
            <div className="space-y-2">
              <p className="text-sm font-medium">{t("approve.effectsTitle")}</p>
              <ul className="divide-y rounded-lg border">
                {p.effects.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-start justify-between gap-2 p-3">
                    <div className="min-w-0 space-y-0.5">
                      <p className="font-medium">{t(`steps.${e.id}`)}</p>
                      <p className="text-sm text-muted-foreground">{t(`approve.effect.${e.id}`)}</p>
                    </div>
                    <StatusBadge
                      tone={WILL_DO_TONE[e.willDo]}
                      label={t(`approve.willDo.${e.willDo}`, { detail: e.detail })}
                      className="max-w-full truncate"
                    />
                  </li>
                ))}
              </ul>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>
                {t("common.cancel")}
              </Button>
              {renamed ? (
                <Button
                  disabled={nameError !== null || preview.isFetching}
                  onClick={() => setCheckedName(name)}
                >
                  {t("approve.recheck")}
                </Button>
              ) : (
                <Button disabled={preview.isFetching} onClick={() => apply(p)}>
                  {preview.isFetching ? t("common.working") : t("approve.submit")}
                </Button>
              )}
            </DialogFooter>
          </div>
        )}
      </QueryState>
      {preview.isError && !preview.data ? (
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("common.close")}
          </Button>
        </DialogFooter>
      ) : null}
    </>
  );
}

const KLIPPY_TONE: Record<string, Tone> = { ready: "ok", startup: "warn", shutdown: "bad", error: "bad" };

export function KlippyBadge({ state }: { state: string | null }) {
  const { t } = useTranslation();
  if (!state) return <StatusBadge tone="neutral" label={t("klippy.none")} />;
  return (
    <StatusBadge
      tone={KLIPPY_TONE[state] ?? "warn"}
      label={t(`klippy.${state}`, { defaultValue: t("klippy.other", { state }) })}
    />
  );
}
