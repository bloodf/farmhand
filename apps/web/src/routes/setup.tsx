import { LOCALES, type Locale } from "@farmhand/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AuthLayout, Field } from "@/components/app/AuthLayout";
import { useErrorText } from "@/components/app/QueryState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setLocale } from "@/i18n";
import { ApiError, fetchJson } from "@/lib/api";
import { q } from "@/lib/queries";

const PASSWORD_MIN = 12;

export const Route = createFileRoute("/setup")({
  beforeLoad: async ({ context: { queryClient } }) => {
    const { needsSetup } = await queryClient.ensureQueryData(q.setupStatus);
    if (!needsSetup) throw redirect({ to: "/login" });
  },
  component: Setup,
});

function Setup() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const errorText = useErrorText();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const short = password.length > 0 && password.length < PASSWORD_MIN;

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (password.length < PASSWORD_MIN) return setError(t("setup.passwordShort", { min: PASSWORD_MIN }));
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    try {
      await fetchJson("/setup", {
        method: "POST",
        json: {
          name: String(form.get("name")).trim(),
          email: String(form.get("email")).trim(),
          password,
          locale: i18n.language,
        },
      });
      // ensureQueryData returns cached rows even when stale; drop them so the layout refetches.
      qc.removeQueries();
      await navigate({ to: "/" });
    } catch (err) {
      if (err instanceof ApiError && err.code === "setup_complete") {
        toast.info(t("setup.alreadyDone"));
        await qc.invalidateQueries({ queryKey: q.setupStatus.queryKey });
        await navigate({ to: "/login" });
        return;
      }
      setError(errorText(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthLayout title={t("setup.title")} description={t("setup.description")}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field id="name" label={t("fields.name")}>
          <Input id="name" name="name" autoComplete="name" required maxLength={80} autoFocus />
        </Field>
        <Field id="email" label={t("fields.email")}>
          <Input id="email" name="email" type="email" autoComplete="username" required />
        </Field>
        <Field
          id="password"
          label={t("fields.password")}
          hint={t("setup.passwordHint", { min: PASSWORD_MIN })}
          error={short ? t("setup.passwordShort", { min: PASSWORD_MIN }) : null}
        >
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={short || undefined}
            aria-describedby={short ? "password-error" : "password-hint"}
          />
        </Field>
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">{t("language.label")}</legend>
          <div className="flex flex-wrap gap-2">
            {LOCALES.map((l: Locale) => (
              <Button
                key={l}
                type="button"
                variant={i18n.language === l ? "default" : "outline"}
                aria-pressed={i18n.language === l}
                onClick={() => setLocale(l)}
              >
                {t(`language.${l}`)}
              </Button>
            ))}
          </div>
        </fieldset>
        <p role="alert" className="text-sm text-destructive empty:hidden">
          {error ?? ""}
        </p>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? t("setup.submitting") : t("setup.submit")}
        </Button>
      </form>
    </AuthLayout>
  );
}
