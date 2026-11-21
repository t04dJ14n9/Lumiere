/**
 * Template expansion for Templates and any later note creator. Pure: no
 * DOM, VS Code or Node APIs.
 */
import { formatMoment, localFields } from "./moment-format";
import { expandWithProperties } from "./template-header";

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

/** Variable names are matched without case, as Obsidian matches them. */
const TOKEN = /\{\{(?:(date|time)(?::([^{}\n]+))?|(title))\}\}/gi;

/**
 * Replaces `{{title}}`, `{{date}}`, `{{time}}`, `{{date:FORMAT}}` and
 * `{{time:FORMAT}}`, in any case (`{{Title}}`, `{{DATE:YYYY}}`). Anything
 * else in braces is left as written.
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
  const expand = (part: string) =>
    part.replace(
      TOKEN,
      (_match, kind: string | undefined, format: string | undefined) => {
        if (!kind) {
          return context.title;
        }
        const formatted = currentDateTime(
          kind.toLowerCase() === "date" ? "date" : "time",
          context,
          format,
        );
        formatted.unsupported.forEach((token) => unsupported.add(token));
        return formatted.text;
      },
    );
  const expanded = expandWithProperties(text, TOKEN, expand);
  return { text: expanded, unsupported: [...unsupported] };
}

/**
 * The date or the time of `context.now` in `format`, else the configured
 * format, else `YYYY-MM-DD` or `HH:mm`: what `{{date}}` and `{{time}}`
 * write, and Insert Current Date and Insert Current Time. `unsupported`
 * lists the tokens written as they are.
 */
export function currentDateTime(
  kind: "date" | "time",
  context: Omit<TemplateContext, "title">,
  format?: string,
): { text: string; unsupported: string[] } {
  const configured =
    kind === "date"
      ? context.dateFormat || DEFAULT_DATE_FORMAT
      : context.timeFormat || DEFAULT_TIME_FORMAT;
  return formatMoment(localFields(context.now), format ?? configured);
}

/** Formats local wall-clock time with a Moment.js pattern. */
export function formatLocalDate(date: Date, pattern: string): string {
  return formatMoment(localFields(date), pattern).text;
}
