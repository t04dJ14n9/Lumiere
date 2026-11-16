/**
 * Moment.js `format()` patterns, as Obsidian's templates and settings use
 * them, with English names. Pure: no DOM, VS Code or Node APIs.
 *
 * The pattern is split as Moment splits it: `[text]` is literal, a run such
 * as `MMMM` or `Do` is one token, and any other character is written as it
 * is (`T`, `-`, `,`). Moment tokens this formatter does not write (locale
 * weeks `w`/`gggg`, eras `N`, time zone names `z`) are written as they are
 * and reported, so a caller can warn instead of inserting a wrong date.
 */

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

// Moment's own token expression (moment/src/lib/format/format.js), without
// its backslash escape, which Obsidian's formats do not use.
const TOKENS =
  /(\[[^[]*\])|([Hh]mm(?:ss)?|Mo|MM?M?M?|Do|DDDo|DD?D?D?|ddd?d?|do?|w[o|w]?|W[o|W]?|Qo?|N{1,5}|YYYYYY|YYYYY|YYYY|YY|y{2,4}|yo?|gg(?:ggg?)?|GG(?:GGG?)?|e|E|a|A|hh?|HH?|kk?|mm?|ss?|S{1,9}|x|X|zz?|ZZ?|.)/g;

/** English long date formats, which Moment expands before formatting. */
const LONG_FORMATS: Record<string, string> = {
  LTS: "h:mm:ss A",
  LT: "h:mm A",
  L: "MM/DD/YYYY",
  LL: "MMMM D, YYYY",
  LLL: "MMMM D, YYYY h:mm A",
  LLLL: "dddd, MMMM D, YYYY h:mm A",
  l: "M/D/YYYY",
  ll: "MMM D, YYYY",
  lll: "MMM D, YYYY h:mm A",
  llll: "ddd, MMM D, YYYY h:mm A",
};

/** The date's fields, local or UTC as the caller chose. */
export interface DateFields {
  year: number;
  /** 0–11. */
  month: number;
  day: number;
  /** 0 (Sunday) – 6. */
  weekday: number;
  hours: number;
  minutes: number;
  seconds: number;
  milliseconds: number;
  /** Minutes east of UTC: +60 for UTC+1. */
  offsetMinutes: number;
  /** Milliseconds since the epoch. */
  time: number;
}

/** The local fields of a date. */
export function localFields(date: Date): DateFields {
  return {
    year: date.getFullYear(),
    month: date.getMonth(),
    day: date.getDate(),
    weekday: date.getDay(),
    hours: date.getHours(),
    minutes: date.getMinutes(),
    seconds: date.getSeconds(),
    milliseconds: date.getMilliseconds(),
    offsetMinutes: -date.getTimezoneOffset(),
    time: date.getTime(),
  };
}

/** The UTC fields of a time, written with a `+00:00` offset. */
export function utcFields(ms: number): DateFields {
  const date = new Date(ms);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth(),
    day: date.getUTCDate(),
    weekday: date.getUTCDay(),
    hours: date.getUTCHours(),
    minutes: date.getUTCMinutes(),
    seconds: date.getUTCSeconds(),
    milliseconds: date.getUTCMilliseconds(),
    offsetMinutes: 0,
    time: ms,
  };
}

export interface Formatted {
  text: string;
  /** Moment tokens written as they are because this formatter lacks them. */
  unsupported: string[];
}

/** Formats `fields` with a Moment pattern. */
export function formatMoment(fields: DateFields, pattern: string): Formatted {
  const unsupported: string[] = [];
  const expanded = pattern.replace(
    /(\[[^[]*\])|(LTS|LT|LL?L?L?|l{1,4})/g,
    (match, literal: string | undefined) =>
      literal ?? LONG_FORMATS[match] ?? match,
  );
  const text = expanded.replace(
    TOKENS,
    (match, literal: string | undefined) => {
      if (literal !== undefined) {
        return literal.slice(1, -1);
      }
      const written = writeToken(fields, match);
      if (written !== undefined) {
        return written;
      }
      if (/^[A-Za-z]/.test(match) && isMomentToken(match)) {
        unsupported.push(match);
      }
      return match;
    },
  );
  return { text, unsupported: [...new Set(unsupported)] };
}

/** The Moment tokens of a pattern this formatter cannot write. */
export function unsupportedMomentTokens(pattern: string): string[] {
  return formatMoment(utcFields(0), pattern).unsupported;
}

/** Letters Moment reads as a token; any other letter is literal. */
function isMomentToken(token: string): boolean {
  return /^(?:w[ow]?|W[oW]?|N{1,5}|y{2,4}|yo?|gg(?:ggg?)?|zz?|YYYYY|YYYYYY)$/.test(
    token,
  );
}

const pad = (value: number, length = 2) =>
  String(Math.abs(value)).padStart(length, "0");

function ordinal(value: number): string {
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) {
    return `${value}th`;
  }
  const suffix = ["th", "st", "nd", "rd"][value % 10] ?? "th";
  return `${value}${suffix}`;
}

function writeToken(fields: DateFields, token: string): string | undefined {
  return (
    yearToken(fields, token) ??
    monthToken(fields, token) ??
    dayToken(fields, token) ??
    timeToken(fields, token) ??
    zoneToken(fields, token)
  );
}

function yearToken(fields: DateFields, token: string): string | undefined {
  switch (token) {
    case "YYYY":
      return pad(fields.year, 4);
    case "YY":
      return pad(fields.year % 100);
    case "Q":
      return String(Math.floor(fields.month / 3) + 1);
    case "Qo":
      return ordinal(Math.floor(fields.month / 3) + 1);
    case "GGGG":
      return pad(isoWeek(fields).year, 4);
    case "GG":
      return pad(isoWeek(fields).year % 100);
    case "W":
      return String(isoWeek(fields).week);
    case "WW":
      return pad(isoWeek(fields).week);
    case "Wo":
      return ordinal(isoWeek(fields).week);
    default:
      return undefined;
  }
}

function monthToken(fields: DateFields, token: string): string | undefined {
  switch (token) {
    case "M":
      return String(fields.month + 1);
    case "Mo":
      return ordinal(fields.month + 1);
    case "MM":
      return pad(fields.month + 1);
    case "MMM":
      return MONTHS[fields.month]!.slice(0, 3);
    case "MMMM":
      return MONTHS[fields.month]!;
    default:
      return undefined;
  }
}

function dayToken(fields: DateFields, token: string): string | undefined {
  switch (token) {
    case "D":
      return String(fields.day);
    case "Do":
      return ordinal(fields.day);
    case "DD":
      return pad(fields.day);
    case "DDD":
      return String(dayOfYear(fields));
    case "DDDo":
      return ordinal(dayOfYear(fields));
    case "DDDD":
      return pad(dayOfYear(fields), 3);
    case "d":
      return String(fields.weekday);
    case "do":
      return ordinal(fields.weekday);
    case "dd":
      return WEEKDAYS[fields.weekday]!.slice(0, 2);
    case "ddd":
      return WEEKDAYS[fields.weekday]!.slice(0, 3);
    case "dddd":
      return WEEKDAYS[fields.weekday]!;
    case "E":
      return String(fields.weekday || 7);
    case "e":
      // English weeks start on Sunday, so the locale weekday is `d`.
      return String(fields.weekday);
    default:
      return undefined;
  }
}

function timeToken(fields: DateFields, token: string): string | undefined {
  switch (token) {
    case "m":
      return String(fields.minutes);
    case "mm":
      return pad(fields.minutes);
    case "s":
      return String(fields.seconds);
    case "ss":
      return pad(fields.seconds);
    case "A":
      return fields.hours < 12 ? "AM" : "PM";
    case "a":
      return fields.hours < 12 ? "am" : "pm";
    default:
      return (
        hourToken(fields, token) ??
        compactTimeToken(fields, token) ??
        fractionToken(fields, token)
      );
  }
}

function hourToken(fields: DateFields, token: string): string | undefined {
  const twelve = fields.hours % 12 || 12;
  switch (token) {
    case "H":
      return String(fields.hours);
    case "HH":
      return pad(fields.hours);
    case "h":
      return String(twelve);
    case "hh":
      return pad(twelve);
    case "k":
      return String(fields.hours || 24);
    case "kk":
      return pad(fields.hours || 24);
    default:
      return undefined;
  }
}

/** Moment's `Hmm`, `Hmmss`, `hmm` and `hmmss`. */
function compactTimeToken(
  fields: DateFields,
  token: string,
): string | undefined {
  const match = /^([Hh])mm(ss)?$/.exec(token);
  if (!match) {
    return undefined;
  }
  const hours =
    match[1] === "H" ? String(fields.hours) : String(fields.hours % 12 || 12);
  return `${hours}${pad(fields.minutes)}${match[2] ? pad(fields.seconds) : ""}`;
}

function fractionToken(fields: DateFields, token: string): string | undefined {
  if (!/^S{1,9}$/.test(token)) {
    return undefined;
  }
  return pad(fields.milliseconds, 3)
    .padEnd(token.length, "0")
    .slice(0, token.length);
}

function zoneToken(fields: DateFields, token: string): string | undefined {
  switch (token) {
    case "Z":
    case "ZZ": {
      const sign = fields.offsetMinutes < 0 ? "-" : "+";
      const hours = pad(Math.floor(Math.abs(fields.offsetMinutes) / 60));
      const minutes = pad(Math.abs(fields.offsetMinutes) % 60);
      return `${sign}${hours}${token === "Z" ? ":" : ""}${minutes}`;
    }
    case "X":
      return String(Math.floor(fields.time / 1000));
    case "x":
      return String(fields.time);
    default:
      return undefined;
  }
}

function dayOfYear(fields: DateFields): number {
  const start = Date.UTC(fields.year, 0, 1);
  return (
    Math.round(
      (Date.UTC(fields.year, fields.month, fields.day) - start) / 86_400_000,
    ) + 1
  );
}

/** ISO 8601 week and week-year: weeks start on Monday, week 1 holds January 4. */
function isoWeek(fields: DateFields): { year: number; week: number } {
  const date = new Date(Date.UTC(fields.year, fields.month, fields.day));
  const weekday = date.getUTCDay() || 7;
  // The Thursday of this week decides the year.
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const year = date.getUTCFullYear();
  const week = Math.ceil(
    ((date.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7,
  );
  return { year, week };
}
