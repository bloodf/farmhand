import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LanguageMenu, ThemeMenu } from "./AppShell";

export function AuthLayout({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-14 items-center justify-between px-4">
        <span className="font-semibold">{t("app.name")}</span>
        <div className="flex gap-1">
          <ThemeMenu />
          <LanguageMenu />
        </div>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-[8vh] pb-8">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>
              <h1 className="text-lg font-semibold">{title}</h1>
            </CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent>{children}</CardContent>
        </Card>
      </main>
    </div>
  );
}

export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
