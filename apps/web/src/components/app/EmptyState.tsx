import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  actions,
}: {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-10 text-center">
      <Icon aria-hidden className="size-8 text-muted-foreground" />
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        {description ? <p className="max-w-prose text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap justify-center gap-2">{actions}</div> : null}
    </div>
  );
}
