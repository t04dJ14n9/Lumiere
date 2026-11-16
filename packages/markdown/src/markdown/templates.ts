/**
 * Template expansion for Templates and any later note creator. Pure: no
 * DOM, VS Code or Node APIs.
 */
import {
  formatMoment,
  localFields,
  unsupportedMomentTokens,
} from "./moment-format";

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
  return expandTemplateWithReport(text, context).text;
}

/**
 * `expandTemplate`, with the Moment tokens of its formats that were written
 * as they are because Lumiere cannot format them (`w`, `gggg`, `N`, `z`).
 */
export function expandTemplateWithReport(
  text: string,
  context: TemplateContext,
): { text: string; unsupported: string[] } {
  const unsupported = new Set<string>();
  const expanded = text.replace(
    TOKEN,
    (_match, kind: string | undefined, format: string | undefined) => {
      if (!kind) {
        return context.title;
      }
      const configured =
        kind === "date"
          ? context.dateFormat || DEFAULT_DATE_FORMAT
          : context.timeFormat || DEFAULT_TIME_FORMAT;
      const formatted = formatMoment(
        localFields(context.now),
        format ?? configured,
      );
      formatted.unsupported.forEach((token) => unsupported.add(token));
      return formatted.text;
    },
  );
  return { text: expanded, unsupported: [...unsupported] };
}

/** Formats local wall-clock time with a Moment.js pattern. */
export function formatLocalDate(date: Date, pattern: string): string {
  return formatMoment(localFields(date), pattern).text;
}

/** True when Lumiere can write every Moment token of the pattern. */
export function isSupportedDateFormat(pattern: string): boolean {
  return pattern.trim() !== "" && unsupportedMomentTokens(pattern).length === 0;
}
