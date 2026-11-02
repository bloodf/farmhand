import {
  DEFAULT_MOONRAKER_PORT,
  forbiddenClass,
  isValidPort,
  nameProblem,
  parseIpv4,
} from "@farmhand/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CheckIcon, LoaderCircleIcon, RadarIcon, XIcon } from "lucide-react";
import { type ChangeEvent, type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { type ApproveTarget, ApproveWizard, KlippyBadge } from "@/components/app/ApproveWizard";
import { Field } from "@/components/app/AuthLayout";
import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import { EmptyState } from "@/components/app/EmptyState";
import { PageHeader } from "@/components/app/PageHeader";
import { QueryState, useErrorText } from "@/components/app/QueryState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ApiError, fetchJson } from "@/lib/api";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import { useLive } from "@/lib/live";
import { q } from "@/lib/queries";
import { useHasRole } from "@/lib/session";
import type { Candidate, Identity } from "@/lib/types";

export const Route = createFileRoute("/_app/discover")({
  staticData: { titleKey: "nav.discover" },
  validateSearch: (s: Record<string, unknown>): { add?: 1 } => (Number(s.add) === 1 ? { add: 1 } : {}),
  component: DiscoverPage,
});

/** Candidate names come from mDNS; only pass one the server will accept. */
const safeName = (name: string | null) => (name && !nameProblem(name) ? name : undefined);

function DiscoverPage() {
  const { t } = useTranslation();
  const { add } = Route.useSearch();
  const candidates = useQuery(q.candidates);
  const settings = useQuery(q.settings);
  const discovery = useLive().data?.discovery;
  const canOperate = useHasRole("operator");
  const errorText = useErrorText();
  const [starting, setStarting] = useState(false);
  const [target, setTarget] = useState<ApproveTarget | null>(null);
  const interval = settings.data?.discoveryIntervalMin;
  const running = starting || discovery?.running === true;

  const runNow = async () => {
    setStarting(true);
    try {
      await fetchJson("/discovery/run", { method: "POST" });
    } catch (err) {
      if (err instanceof ApiError && err.code === "busy") toast.info(t("discover.busy"));
      else toast.error(errorText(err));
    } finally {
      setStarting(false);
    }
  };

  return (
    <>
      <PageHeader
        title={t("discover.title")}
        description={
          <span className="flex flex-col gap-0.5">
            {discovery?.lastRunAt ? (
              <span>{t("discover.lastRun", { time: fmtDateTime(discovery.lastRunAt) })}</span>
            ) : null}
            {discovery?.lastError ? (
              <span className="text-destructive">
                {t("discover.lastError", { error: discovery.lastError })}
              </span>
            ) : null}
          </span>
        }
        actions={
          canOperate ? (
            <Button onClick={runNow} disabled={running}>
              {running ? (
                <LoaderCircleIcon aria-hidden className="animate-spin motion-reduce:animate-none" />
              ) : (
                <RadarIcon aria-hidden />
              )}
              {running ? t("discover.searching") : t("discover.now")}
            </Button>
          ) : null
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <section aria-labelledby="candidates-title" className="space-y-3">
          <h2 id="candidates-title" className="font-medium">
            {t("discover.candidates")}
          </h2>
          <QueryState
            query={candidates}
            isEmpty={(items) => items.length === 0}
            empty={
              <EmptyState
                icon={RadarIcon}
                title={t("discover.empty.title")}
                description={
                  interval
                    ? t("discover.empty.description", { count: interval })
                    : t("discover.empty.descriptionNoInterval")
                }
              />
            }
          >
            {(items) => (
              <ul className="divide-y rounded-lg border">
                {items.map((c) => (
                  <CandidateRow
                    key={`${c.host}:${c.port}`}
                    candidate={c}
                    canOperate={canOperate}
                    onApprove={() => setTarget({ ip: c.host, port: c.port, name: safeName(c.name) })}
                  />
                ))}
              </ul>
            )}
          </QueryState>
        </section>
        {canOperate ? <AddByIp autoFocus={add === 1} onApprove={setTarget} /> : null}
      </div>
      <ApproveWizard target={target} onClose={() => setTarget(null)} />
    </>
  );
}

function CandidateRow({
  candidate: c,
  canOperate,
  onApprove,
}: {
  candidate: Candidate;
  canOperate: boolean;
  onApprove: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const errorText = useErrorText();
  const [dismissing, setDismissing] = useState(false);

  const dismiss = async () => {
    try {
      await fetchJson(`/candidates/${encodeURIComponent(c.host)}/${c.port}/dismiss`, { method: "POST" });
      await qc.invalidateQueries({ queryKey: ["candidates"] });
    } catch (err) {
      toast.error(errorText(err));
      throw err;
    }
  };

  const label = c.name ?? t("discover.unnamed");
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 p-3">
      <div className="min-w-0 space-y-0.5">
        <p className="font-medium break-words">{label}</p>
        <p className="font-mono text-xs text-muted-foreground">
          {c.host}:{c.port}
        </p>
        <p className="text-xs text-muted-foreground">
          <span title={fmtDateTime(c.lastSeenAt)}>
            {t("discover.lastSeen", { time: fmtRelative(c.lastSeenAt) })}
          </span>
          {" · "}
          {t(`candidateSource.${c.source}`)}
          {c.moonrakerVersion ? ` · ${t("discover.moonraker", { version: c.moonrakerVersion })}` : ""}
        </p>
        <KlippyBadge state={c.klippyState} />
      </div>
      {canOperate ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setDismissing(true)}>
            <XIcon aria-hidden />
            {t("discover.dismiss")}
          </Button>
          <Button onClick={onApprove}>
            <CheckIcon aria-hidden />
            {t("discover.approve")}
          </Button>
        </div>
      ) : null}
      <ConfirmDialog
        open={dismissing}
        onOpenChange={setDismissing}
        title={t("discover.dismissTitle", { name: label })}
        effects={[t("discover.dismissEffect"), t("discover.dismissUndo")]}
        confirmLabel={t("discover.dismiss")}
        onConfirm={dismiss}
      />
    </li>
  );
}

type Errors = Partial<Record<"name" | "ip" | "port", string>>;

function AddByIp({ autoFocus, onApprove }: { autoFocus: boolean; onApprove: (t: ApproveTarget) => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [values, setValues] = useState({ name: "", ip: "", port: String(DEFAULT_MOONRAKER_PORT) });
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);
  const [found, setFound] = useState<{ target: ApproveTarget; identity: Identity } | null>(null);
  const [rejected, setRejected] = useState<string | null>(null);

  const validate = (): Errors => {
    const out: Errors = {};
    const name = values.name === "" ? null : nameProblem(values.name);
    if (name) out.name = t(`validation.name.${name}`);
    const parts = parseIpv4(values.ip);
    const ipProblem = parts ? forbiddenClass(parts) : "invalid_ipv4";
    // Dev servers may allow loopback (fake printers); the server still decides.
    if (ipProblem && !(import.meta.env.DEV && ipProblem === "loopback"))
      out.ip = t(`validation.ip.${ipProblem}`);
    if (!isValidPort(Number(values.port)) || values.port.trim() === "") out.port = t("validation.port");
    return out;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next = validate();
    setErrors(next);
    setFound(null);
    setRejected(null);
    if (Object.keys(next).length > 0) return;
    const target = { ip: values.ip, port: Number(values.port), name: values.name || undefined };
    setPending(true);
    try {
      const r = await fetchJson<{ identity: Identity }>("/discovery/probe", {
        method: "POST",
        json: { ip: target.ip, port: target.port },
      });
      setFound({ target, identity: r.identity });
    } catch (err) {
      setRejected(errorText(err));
    } finally {
      setPending(false);
    }
  };

  const field = (key: keyof typeof values) => ({
    id: `add-${key}`,
    value: values[key],
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      setValues((v) => ({ ...v, [key]: e.target.value }));
      setFound(null);
      setRejected(null);
    },
    "aria-invalid": errors[key] ? true : undefined,
    "aria-describedby": errors[key] ? `add-${key}-error` : undefined,
  });

  return (
    <Card id="add" className="h-fit">
      <CardHeader>
        <CardTitle>
          <h2>{t("discover.add.title")}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field
            id="add-name"
            label={t("fields.printerNameOptional")}
            error={errors.name}
            hint={t("discover.add.nameHint")}
          >
            <Input {...field("name")} maxLength={80} autoFocus={autoFocus} />
          </Field>
          <Field id="add-ip" label={t("fields.ip")} error={errors.ip} hint={t("discover.add.ipHint")}>
            <Input {...field("ip")} inputMode="decimal" autoComplete="off" className="font-mono" />
          </Field>
          <Field id="add-port" label={t("fields.port")} error={errors.port}>
            <Input {...field("port")} inputMode="numeric" className="font-mono" />
          </Field>
          {rejected ? (
            <p role="alert" className="text-sm text-destructive">
              {rejected}
            </p>
          ) : null}
          {found ? (
            <div role="status" className="space-y-2 rounded-lg border p-3 text-sm">
              <p className="font-medium">{t("discover.add.found")}</p>
              <p className="text-muted-foreground">
                {t("discover.moonraker", { version: found.identity.moonrakerVersion })}
                {found.identity.hostname ? ` · ${found.identity.hostname}` : ""}
              </p>
              <KlippyBadge state={found.identity.klippyState} />
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant={found ? "outline" : "default"} disabled={pending}>
              {pending ? t("discover.add.checking") : t("discover.add.check")}
            </Button>
            {found ? (
              <Button type="button" onClick={() => onApprove(found.target)}>
                <CheckIcon aria-hidden />
                {t("discover.approve")}
              </Button>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
