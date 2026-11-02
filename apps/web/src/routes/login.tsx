import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { AuthLayout, Field } from "@/components/app/AuthLayout";
import { useErrorText } from "@/components/app/QueryState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetchJson } from "@/lib/api";
import { q } from "@/lib/queries";

export const Route = createFileRoute("/login")({
  beforeLoad: async ({ context: { queryClient } }) => {
    const { needsSetup } = await queryClient.ensureQueryData(q.setupStatus);
    if (needsSetup) throw redirect({ to: "/setup" });
    if (await queryClient.ensureQueryData(q.session)) throw redirect({ to: "/" });
  },
  component: Login,
});

function Login() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const errorText = useErrorText();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    try {
      await fetchJson("/auth/sign-in/email", {
        method: "POST",
        json: { email: String(form.get("email")), password: String(form.get("password")) },
      });
      qc.removeQueries({ queryKey: q.session.queryKey });
      await navigate({ to: "/" });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthLayout title={t("login.title")} description={t("login.description")}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field id="email" label={t("fields.email")}>
          <Input id="email" name="email" type="email" autoComplete="username" required autoFocus />
        </Field>
        <Field id="password" label={t("fields.password")}>
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </Field>
        <p role="alert" className="text-sm text-destructive empty:hidden">
          {error ?? ""}
        </p>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? t("login.submitting") : t("login.submit")}
        </Button>
      </form>
    </AuthLayout>
  );
}
