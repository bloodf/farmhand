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

const REL_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400],
  ["hour", 3600],
  ["minute", 60],
  ["second", 1],
];

/** "3 minutes ago". Pair it with fmtDateTime in a title for the exact time. */
export const fmtRelative = (iso: string, now = Date.now()): string => {
  const diff = Math.round((new Date(iso).getTime() - now) / 1000);
  const [unit, size] = REL_UNITS.find(([, s]) => Math.abs(diff) >= s) ?? ["second", 1];
  return new Intl.RelativeTimeFormat(lang(), { numeric: "auto" }).format(Math.round(diff / size), unit);
};
