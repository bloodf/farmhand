import {
  DEFAULT_MOONRAKER_PORT,
  forbiddenClass,
  isValidPort,
  nameProblem,
  parseIpv4,
} from "@farmhand/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PlusIcon, RadarIcon } from "lucide-react";
import { type ChangeEvent, type FormEvent, type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Field } from "@/components/app/AuthLayout";
import { EmptyState } from "@/components/app/EmptyState";
import { PageHeader } from "@/components/app/PageHeader";
import { QueryState } from "@/components/app/QueryState";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fmtDateTime } from "@/lib/format";
import { useLive } from "@/lib/live";
import { q } from "@/lib/queries";

export const Route = createFileRoute("/_app/discover")({
  staticData: { titleKey: "nav.discover" },
  validateSearch: (s: Record<string, unknown>): { add?: 1 } => (Number(s.add) === 1 ? { add: 1 } : {}),
  component: DiscoverPage,
});

/** A disabled action that stays focusable so its tooltip can say why. */
function Soon({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <Tooltip>
      <TooltipTrigger render={<Button disabled focusableWhenDisabled />}>{children}</TooltipTrigger>
      <TooltipContent>{t("common.comingSoon")}</TooltipContent>
    </Tooltip>
  );
}

function DiscoverPage() {
  const { t } = useTranslation();
  const { add } = Route.useSearch();
  const candidates = useQuery(q.candidates);
  const settings = useQuery(q.settings);
  const discovery = useLive().data?.discovery;
  const interval = settings.data?.discoveryIntervalMin;

  return (
    <>
      <PageHeader
        title={t("discover.title")}
        description={
          discovery?.lastRunAt ? t("discover.lastRun", { time: fmtDateTime(discovery.lastRunAt) }) : null
        }
        actions={
          <Soon>
            <RadarIcon aria-hidden />
            {t("discover.now")}
          </Soon>
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
                  <li
                    key={`${c.host}:${c.port}`}
                    className="flex flex-wrap items-start justify-between gap-2 p-3"
                  >
                    <div className="min-w-0">
                      <p className="font-medium break-words">{c.name}</p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {c.host}:{c.port}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t("discover.lastSeen", { time: fmtDateTime(c.lastSeenAt) })}
                        {c.moonrakerVersion ? ` · ${c.moonrakerVersion}` : ""}
                      </p>
                    </div>
                    <StatusBadge
                      tone={c.klippyState === "ready" ? "ok" : c.klippyState ? "warn" : "neutral"}
                      label={
                        c.klippyState ? t("discover.klippy", { state: c.klippyState }) : t("common.none")
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
          </QueryState>
        </section>
        <AddByIp autoFocus={add === 1} />
      </div>
    </>
  );
}

type Errors = Partial<Record<"name" | "ip" | "port", string>>;

function AddByIp({ autoFocus }: { autoFocus: boolean }) {
  const { t } = useTranslation();
  const [values, setValues] = useState({ name: "", ip: "", port: String(DEFAULT_MOONRAKER_PORT) });
  const [errors, setErrors] = useState<Errors>({});
  const [checked, setChecked] = useState(false);

  const validate = (): Errors => {
    const out: Errors = {};
    const name = nameProblem(values.name);
    if (name) out.name = t(`validation.name.${name}`);
    const parts = parseIpv4(values.ip);
    const ipProblem = parts ? forbiddenClass(parts) : "invalid_ipv4";
    if (ipProblem) out.ip = t(`validation.ip.${ipProblem}`);
    if (!isValidPort(Number(values.port)) || values.port.trim() === "") out.port = t("validation.port");
    return out;
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next = validate();
    setErrors(next);
    setChecked(Object.keys(next).length === 0);
    // ponytail: approval mutation is wired in phase 5; the form only validates for now.
  };

  const field = (key: keyof typeof values) => ({
    id: `add-${key}`,
    value: values[key],
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      setValues((v) => ({ ...v, [key]: e.target.value }));
      setChecked(false);
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
          <Field id="add-name" label={t("fields.printerName")} error={errors.name}>
            <Input {...field("name")} maxLength={80} autoFocus={autoFocus} />
          </Field>
          <Field id="add-ip" label={t("fields.ip")} error={errors.ip} hint={t("discover.add.ipHint")}>
            <Input {...field("ip")} inputMode="decimal" autoComplete="off" className="font-mono" />
          </Field>
          <Field id="add-port" label={t("fields.port")} error={errors.port}>
            <Input {...field("port")} inputMode="numeric" className="font-mono" />
          </Field>
          <p role="status" className="text-sm text-muted-foreground empty:hidden">
            {checked ? t("discover.add.valid") : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="outline">
              {t("discover.add.check")}
            </Button>
            <Soon>
              <PlusIcon aria-hidden />
              {t("discover.add.submit")}
            </Soon>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
