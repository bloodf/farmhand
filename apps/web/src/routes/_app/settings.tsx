import { LOCALES, SERVICE_LABELS } from "@farmhand/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useTheme } from "next-themes";
import { type FormEvent, type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Field } from "@/components/app/AuthLayout";
import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import { PageHeader } from "@/components/app/PageHeader";
import { QueryState, useErrorText } from "@/components/app/QueryState";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { setLocale } from "@/i18n";
import { ApiError, fetchJson } from "@/lib/api";
import { fmtGrams } from "@/lib/format";
import { q } from "@/lib/queries";
import { useIsAdmin } from "@/lib/session";
import type { Integrations, Settings } from "@/lib/types";

export const Route = createFileRoute("/_app/settings")({
  staticData: { titleKey: "nav.settings" },
  component: SettingsPage,
});

function SettingsPage() {
  const { t } = useTranslation();
  const isAdmin = useIsAdmin();
  const settings = useQuery(q.settings);
  return (
    <>
      <PageHeader title={t("settings.title")} />
      <PreferencesCard />
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("settings.farm.title")}</h2>
          </CardTitle>
          <CardDescription>
            {isAdmin ? t("settings.farm.description") : t("settings.adminOnly")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <QueryState query={settings}>{(s) => <FarmForm initial={s} readOnly={!isAdmin} />}</QueryState>
        </CardContent>
      </Card>
      {isAdmin ? <IntegrationsCard /> : null}
    </>
  );
}

function Choice<T extends string>({
  legend,
  options,
  value,
  onChange,
  label,
}: {
  legend: string;
  options: readonly T[];
  value: string;
  onChange: (v: T) => void;
  label: (v: T) => string;
}) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <Button
            key={o}
            type="button"
            variant={value === o ? "default" : "outline"}
            aria-pressed={value === o}
            onClick={() => onChange(o)}
          >
            {label(o)}
          </Button>
        ))}
      </div>
    </fieldset>
  );
}

function PreferencesCard() {
  const { t, i18n } = useTranslation();
  const { theme = "system", setTheme } = useTheme();
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t("settings.prefs.title")}</h2>
        </CardTitle>
        <CardDescription>{t("settings.prefs.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Choice
          legend={t("language.label")}
          options={LOCALES}
          value={i18n.language}
          onChange={setLocale}
          label={(l) => t(`language.${l}`)}
        />
        <Choice
          legend={t("theme.label")}
          options={["system", "light", "dark"] as const}
          value={theme}
          onChange={setTheme}
          label={(v) => t(`theme.${v}`)}
        />
      </CardContent>
    </Card>
  );
}

const INTERVAL = { min: 1, max: 1440 };
const GRAMS = { min: 0, max: 100_000 };

function FarmForm({ initial, readOnly }: { initial: Settings; readOnly: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const errorText = useErrorText();
  const [interval, setIntervalMin] = useState(String(initial.discoveryIntervalMin));
  const [grams, setGrams] = useState(String(initial.lowStockGrams));
  const [ifaces, setIfaces] = useState<string[]>(initial.lanIfaces);
  const [confirming, setConfirming] = useState(false);

  const intervalN = Number(interval);
  const gramsN = Number(grams);
  const errors = {
    interval:
      Number.isInteger(intervalN) && intervalN >= INTERVAL.min && intervalN <= INTERVAL.max
        ? null
        : t("settings.farm.intervalRange", INTERVAL),
    grams:
      Number.isInteger(gramsN) && gramsN >= GRAMS.min && gramsN <= GRAMS.max
        ? null
        : t("settings.farm.gramsRange", GRAMS),
    ifaces: ifaces.length === 0 ? t("settings.farm.ifacesRequired") : null,
  };
  const valid = !errors.interval && !errors.grams && !errors.ifaces;
  const dirty =
    intervalN !== initial.discoveryIntervalMin ||
    gramsN !== initial.lowStockGrams ||
    [...ifaces].sort().join() !== [...initial.lanIfaces].sort().join();

  // Interfaces the server still has configured but the host no longer reports.
  const allIfaces = [...new Set([...initial.availableIfaces, ...initial.lanIfaces])];

  const save = async () => {
    try {
      const next = await fetchJson<Settings>("/settings", {
        method: "PATCH",
        json: { discoveryIntervalMin: intervalN, lanIfaces: ifaces, lowStockGrams: gramsN },
      });
      qc.setQueryData(q.settings.queryKey, next);
      toast.success(t("settings.farm.saved"));
    } catch (err) {
      toast.error(
        err instanceof ApiError && err.code === "unknown_iface"
          ? t("errors.unknown_iface", { iface: (err.body as { iface?: string }).iface ?? "" })
          : errorText(err),
      );
      throw err;
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid && dirty) setConfirming(true);
  };

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="interval"
          label={t("settings.farm.interval")}
          error={errors.interval}
          hint={t("settings.farm.intervalHint")}
        >
          <Input
            id="interval"
            inputMode="numeric"
            value={interval}
            onChange={(e) => setIntervalMin(e.target.value)}
            disabled={readOnly}
            aria-invalid={errors.interval ? true : undefined}
          />
        </Field>
        <Field
          id="grams"
          label={t("settings.farm.grams")}
          error={errors.grams}
          hint={t("settings.farm.gramsHint")}
        >
          <Input
            id="grams"
            inputMode="numeric"
            value={grams}
            onChange={(e) => setGrams(e.target.value)}
            disabled={readOnly}
            aria-invalid={errors.grams ? true : undefined}
          />
        </Field>
      </div>
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">{t("settings.farm.ifaces")}</legend>
        <p className="text-xs text-muted-foreground">{t("settings.farm.ifacesHint")}</p>
        {allIfaces.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("settings.farm.noIfaces")}</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {allIfaces.map((name) => {
              const missing = !initial.availableIfaces.includes(name);
              return (
                <li key={name}>
                  <label
                    htmlFor={`iface-${name}`}
                    className="flex min-h-11 items-center justify-between gap-3 px-3"
                  >
                    <span className="flex items-center gap-2 font-mono text-sm">
                      {name}
                      {missing ? <StatusBadge tone="warn" label={t("settings.farm.ifaceMissing")} /> : null}
                    </span>
                    <Switch
                      id={`iface-${name}`}
                      checked={ifaces.includes(name)}
                      disabled={readOnly}
                      onCheckedChange={(on) =>
                        setIfaces((cur) => (on ? [...cur, name] : cur.filter((i) => i !== name)))
                      }
                    />
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        {errors.ifaces ? <p className="text-sm text-destructive">{errors.ifaces}</p> : null}
      </fieldset>
      {readOnly ? null : (
        <Button type="submit" disabled={!valid || !dirty}>
          {t("common.save")}
        </Button>
      )}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("settings.farm.confirmTitle")}
        confirmLabel={t("common.save")}
        effects={[
          t("settings.farm.effectInterval", { count: intervalN }),
          t("settings.farm.effectIfaces", { ifaces: ifaces.join(", ") }),
          t("settings.farm.effectGrams", { amount: fmtGrams(gramsN) }),
        ]}
        onConfirm={save}
      />
    </form>
  );
}

function IntegrationsCard() {
  const { t } = useTranslation();
  const integrations = useQuery(q.integrations);
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t("settings.integrations.title")}</h2>
        </CardTitle>
        <CardDescription>{t("settings.integrations.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <QueryState query={integrations}>{(i) => <IntegrationRows i={i} />}</QueryState>
      </CardContent>
    </Card>
  );
}

function IntegrationRows({ i }: { i: Integrations }) {
  const { t } = useTranslation();
  const yes = (ok: boolean, okKey: string, noKey: string) => (
    <StatusBadge tone={ok ? "ok" : "warn"} label={t(ok ? okKey : noKey)} />
  );
  const rows: { key: string; label: string; detail?: string | null; status: ReactNode }[] = [
    {
      key: "helper",
      label: t("settings.integrations.helper"),
      status: (
        <StatusBadge
          tone={i.helper === "socket" ? "ok" : "warn"}
          label={t(`settings.integrations.helperMode.${i.helper}`)}
        />
      ),
    },
    {
      key: "lan",
      label: t("settings.integrations.lanIp"),
      detail: i.lanIp,
      status: yes(Boolean(i.lanIp), "settings.integrations.set", "settings.integrations.notSet"),
    },
    {
      key: "printstash",
      label: SERVICE_LABELS.printstash,
      detail: i.printstash.url,
      status: yes(
        i.printstash.credentials,
        "settings.integrations.credentials",
        "settings.integrations.noCredentials",
      ),
    },
    {
      key: "fdm",
      label: SERVICE_LABELS["fdm-monster"],
      detail: i.fdm.url,
      status: yes(
        i.fdm.credentials,
        "settings.integrations.credentials",
        "settings.integrations.noCredentials",
      ),
    },
    {
      key: "spoolman",
      label: SERVICE_LABELS.spoolman,
      detail: i.spoolman.url,
      status: yes(
        Boolean(i.spoolman.publicUrl),
        "settings.integrations.public",
        "settings.integrations.noPublic",
      ),
    },
    {
      key: "orcaslicer",
      label: SERVICE_LABELS.orcaslicer,
      detail: i.orcaslicer.url,
      status: yes(
        Boolean(i.orcaslicer.publicUrl),
        "settings.integrations.public",
        "settings.integrations.noPublic",
      ),
    },
    {
      key: "ha",
      label: t("settings.integrations.homeAssistant"),
      status: yes(i.homeAssistant.configured, "settings.integrations.set", "settings.integrations.notSet"),
    },
  ];
  return (
    <ul className="divide-y rounded-md border">
      {rows.map((r) => (
        <li key={r.key} className="flex flex-wrap items-center justify-between gap-2 p-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">{r.label}</p>
            {r.detail ? (
              <p className="font-mono text-xs break-all text-muted-foreground">{r.detail}</p>
            ) : null}
          </div>
          {r.status}
        </li>
      ))}
    </ul>
  );
}
