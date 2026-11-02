import i18n from "@/i18n";

const lang = () => i18n.language;

export const fmtDateTime = (iso: string | null | undefined): string =>
  iso
    ? new Intl.DateTimeFormat(lang(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso))
    : "";

export const fmtTime = (iso: string | null | undefined): string =>
  iso ? new Intl.DateTimeFormat(lang(), { timeStyle: "medium" }).format(new Date(iso)) : "";

export const fmtPercent = (v: number): string =>
  new Intl.NumberFormat(lang(), { style: "percent", maximumFractionDigits: 0 }).format(v);

export const fmtGrams = (g: number): string =>
  g >= 1000
    ? new Intl.NumberFormat(lang(), { style: "unit", unit: "kilogram", maximumFractionDigits: 2 }).format(
        g / 1000,
      )
    : new Intl.NumberFormat(lang(), { style: "unit", unit: "gram", maximumFractionDigits: 0 }).format(g);

export const fmtNumber = (n: number): string => new Intl.NumberFormat(lang()).format(n);

export const fmtTemp = (v: number): string =>
  new Intl.NumberFormat(lang(), { style: "unit", unit: "celsius", maximumFractionDigits: 0 }).format(v);

export const fmtDuration = (s: number): string => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const unit = (value: number, u: "hour" | "minute") =>
    new Intl.NumberFormat(lang(), { style: "unit", unit: u, unitDisplay: "narrow" }).format(value);
  return h > 0 ? `${unit(h, "hour")} ${unit(m, "minute")}` : unit(m, "minute");
};
