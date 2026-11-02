import { Link, useRouter } from "@tanstack/react-router";
import { AlertTriangleIcon, CompassIcon, RotateCwIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { EmptyState } from "./EmptyState";
import { useErrorText } from "./QueryState";

export function RouteError({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const router = useRouter();
  const errorText = useErrorText();
  return (
    <div className="mx-auto max-w-xl p-4 sm:p-6">
      <EmptyState
        icon={AlertTriangleIcon}
        title={t("errors.loadFailed")}
        description={errorText(error)}
        actions={
          <Button onClick={() => router.invalidate()}>
            <RotateCwIcon aria-hidden />
            {t("common.retry")}
          </Button>
        }
      />
    </div>
  );
}

export function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-xl p-4 sm:p-6">
      <EmptyState
        icon={CompassIcon}
        title={t("notFound.title")}
        description={t("notFound.description")}
        actions={
          <Button nativeButton={false} render={<Link to="/" />}>
            {t("notFound.home")}
          </Button>
        }
      />
    </div>
  );
}
