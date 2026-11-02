/** Printer names end up in INI sections and API payloads; keep them boring. */
export const NAME_MIN = 1;
export const NAME_MAX = 80;

/** Control characters, line/paragraph separators and INI section brackets. */
const FORBIDDEN = /[\p{C}\p{Zl}\p{Zp}[\]]/u;

export type NameRejection = "length" | "whitespace" | "forbidden_chars";

export function nameProblem(name: string): NameRejection | null {
  if (name.length < NAME_MIN || name.length > NAME_MAX) return "length";
  if (name !== name.trim()) return "whitespace";
  if (FORBIDDEN.test(name)) return "forbidden_chars";
  return null;
}
