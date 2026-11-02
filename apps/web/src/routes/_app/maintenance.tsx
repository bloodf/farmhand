import { createFileRoute } from "@tanstack/react-router";
import { ArchiveIcon, type LucideIcon, ScrollTextIcon, ServerIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/app/EmptyState";
import { PageHeader } from "@/components/app/PageHeader";

export const Route = createFileRoute("/_app/maintenance")({
  staticData: { titleKey: "nav.maintenance" },
  component: MaintenancePage,
});

const SECTIONS: { key: "services" | "logs" | "backup"; icon: LucideIcon }[] = [
  { key: "services", icon: ServerIcon },
  { key: "logs", icon: ScrollTextIcon },
  { key: "backup", icon: ArchiveIcon },
];

function MaintenancePage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t("maintenance.title")} description={t("maintenance.description")} />
      {SECTIONS.map(({ key, icon }) => (
        <section key={key} aria-labelledby={`m-${key}`} className="space-y-3">
          <h2 id={`m-${key}`} className="font-medium">
            {t(`maintenance.${key}.title`)}
          </h2>
          <EmptyState
            icon={icon}
            title={t("common.comingSoon")}
            description={t(`maintenance.${key}.description`)}
          />
        </section>
      ))}
    </>
  );
}
