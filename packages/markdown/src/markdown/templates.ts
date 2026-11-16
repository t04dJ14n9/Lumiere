/**
 * Template expansion for Templates and any later note creator. Pure: no
 * DOM, VS Code or Node APIs.
 */
import { formatWithPattern } from "./bases/value-methods";

export const DEFAULT_DATE_FORMAT = "YYYY-MM-DD";
const DEFAULT_TIME_FORMAT = "HH:mm";

export interface TemplateContext {
  /** The destination note's basename, without `.md`. */
  readonly title: string;
  readonly now: Date;
  /** Format of `{{date}}`; empty or absent means `YYYY-MM-DD`. */
  readonly dateFormat?: string;
  /** Format of `{{time}}`; empty or absent means `HH:mm`. */
  readonly timeFormat?: string;
}

const TOKEN = /\{\{(?:(date|time)(?::([^{}\n]+))?|(title))\}\}/g;

/**
 * Replaces `{{title}}`, `{{date}}`, `{{time}}`, `{{date:FORMAT}}` and
 * `{{time:FORMAT}}`. Anything else in braces is left as written.
 */
export function expandTemplate(text: string, context: TemplateContext): string {
  return text.replace(
    TOKEN,
    (_match, kind: string | undefined, format: string | undefined) => {
      if (!kind) {
        return context.title;
      }
      const configured =
        kind === "date"
          ? context.dateFormat || DEFAULT_DATE_FORMAT
          : context.timeFormat || DEFAULT_TIME_FORMAT;
      return formatLocalDate(context.now, format ?? configured);
    },
  );
}

/** Formats local wall-clock time with the tokens YYYY, MM, DD, HH, mm and ss. */
export function formatLocalDate(date: Date, pattern: string): string {
  // The shared formatter reads UTC fields; shift them to hold local time.
  const offset = date.getTimezoneOffset() * 60_000;
  return formatWithPattern(date.getTime() - offset, pattern);
}

const SUPPORTED_TOKENS = new Set(["YYYY", "MM", "DD", "HH", "mm", "ss"]);

/**
 * True when every run of one letter in the pattern is exactly a supported
 * token. Moment reads a run as one token, so `MMMM` (the month's name) and
 * `Do` are not `MM` twice or `D` plus `o`: the formatter would write
 * `1111`, and `ddd` or `[literal]` would come out as written.
 */
export function isSupportedDateFormat(pattern: string): boolean {
  if (pattern.trim() === "" || /[[\]]/.test(pattern)) {
    return false;
  }
  const runs = pattern.match(/([A-Za-z])\1*/g) ?? [];
  return runs.every((run) => SUPPORTED_TOKENS.has(run));
}
