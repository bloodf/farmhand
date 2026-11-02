import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

const RESET_MS = 2000;

export function CopyBlock({ label, value }: { label: string; value: string }) {
  const { t } = useTranslation();
  const pre = useRef<HTMLPreElement>(null);
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");

  useEffect(() => {
    if (state !== "copied") return;
    const id = setTimeout(() => setState("idle"), RESET_MS);
    return () => clearTimeout(id);
  }, [state]);

  const copy = async () => {
    try {
      // navigator.clipboard is missing on plain-HTTP LAN origins.
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      const node = pre.current;
      if (node) window.getSelection()?.selectAllChildren(node);
      setState("manual");
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{label}</p>
        <Button variant="outline" onClick={copy} aria-label={t("copy.aria", { label })}>
          {state === "copied" ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
          {state === "copied" ? t("copy.copied") : t("copy.copy")}
        </Button>
      </div>
      <pre
        ref={pre}
        className="overflow-x-auto rounded-md border bg-muted p-3 font-mono text-xs leading-relaxed whitespace-pre"
      >
        {value}
      </pre>
      <p aria-live="polite" className="text-xs text-muted-foreground">
        {state === "manual" ? t("copy.manual") : ""}
      </p>
    </div>
  );
}
