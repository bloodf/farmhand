import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** Every write goes through this: it names the target and effects and waits for the server. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  effects,
  confirmLabel,
  onConfirm,
  destructive = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  effects: string[];
  confirmLabel: string;
  /** Resolve to close; reject to keep the dialog open (the caller reports the error). */
  onConfirm: () => Promise<unknown>;
  destructive?: boolean;
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);

  const confirm = async () => {
    setPending(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      // stay open; caller shows the reason
    } finally {
      setPending(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription render={<div />}>
            <ul className="list-disc space-y-1 pl-5 text-left">
              {effects.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? "destructive" : "default"}
            disabled={pending}
            onClick={confirm}
          >
            {pending ? t("common.working") : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
