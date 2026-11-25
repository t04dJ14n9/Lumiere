import type { GitBlameOk, GitIdentity } from "../../shared/git-blame";
import { t } from "@workshop/l10n";

type GhostBlame = Pick<
  GitBlameOk,
  | "authorName"
  | "authorEmail"
  | "authorDate"
  | "subject"
  | "body"
  | "committerDate"
>;
const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });
/** Match VS Code git.blame subject truncate (`_subjectMaxLength = 50`). */
const SUBJECT_MAX_GRAPHEMES = 50;
/** Each unit's length in seconds and how a count of it reads, when shown. */
const relativeUnits: readonly (readonly [number, (count: number) => string])[] =
  [
    [31536000, (n) => (n === 1 ? t("{0} year ago", n) : t("{0} years ago", n))],
    [
      2592000,
      (n) => (n === 1 ? t("{0} month ago", n) : t("{0} months ago", n)),
    ],
    [604800, (n) => (n === 1 ? t("{0} week ago", n) : t("{0} weeks ago", n))],
    [86400, (n) => (n === 1 ? t("{0} day ago", n) : t("{0} days ago", n))],
    [3600, (n) => (n === 1 ? t("{0} hour ago", n) : t("{0} hours ago", n))],
    [60, (n) => (n === 1 ? t("{0} minute ago", n) : t("{0} minutes ago", n))],
  ];

const absoluteFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "long",
  timeStyle: "short",
});

/**
 * VS Code default `git.blame.editorDecoration.template`:
 * `${subject}, ${authorName} (${authorDateAgo})`
 * “You” for self is kept when identity matches (reads naturally in that shape).
 */
export function formatBlameGhost(
  blame: GhostBlame,
  identity: GitIdentity | undefined,
  now = Date.now() / 1000,
): string {
  const author = authorLabel(blame, identity);
  const relative = relativeTime(blame.authorDate, now);
  const subject = truncateSubject(blame.subject);
  if (!subject) {
    return `${author} (${relative})`;
  }
  return `${subject}, ${author} (${relative})`;
}

/**
 * Multi-line hover content: author, relative + absolute time (and committer
 * lag when present), full subject, then the commit body.
 */
export function formatBlameTooltip(
  blame: GhostBlame,
  identity: GitIdentity | undefined,
  now = Date.now() / 1000,
): string {
  const author = authorLabel(blame, identity);
  const relative = relativeTime(blame.authorDate, now);
  const absolute = absoluteFormat.format(new Date(blame.authorDate * 1000));
  const when =
    blame.committerDate !== undefined &&
    blame.committerDate > 0 &&
    blame.committerDate !== blame.authorDate
      ? t(
          "{0} ({1}, committed {2})",
          relative,
          absolute,
          relativeTime(blame.committerDate, now),
        )
      : `${relative} (${absolute})`;
  const subject = firstLine(blame.subject);
  const body = (blame.body ?? "").replace(/^\s+|\s+$/gu, "");
  const lines = [author, when];
  if (subject) {
    lines.push(subject);
  }
  if (body) {
    lines.push("", body);
  }
  return lines.join("\n");
}

function authorLabel(
  blame: GhostBlame,
  identity: GitIdentity | undefined,
): string {
  const name = blame.authorName.trim();
  const email = blame.authorEmail.trim();
  const sameEmail =
    email.length > 0 &&
    email.toLowerCase() === identity?.userEmail?.trim().toLowerCase();
  const sameName = name.length > 0 && name === identity?.userName?.trim();
  if (sameEmail || sameName) {
    return t("You");
  }
  return name || email.split("@")[0] || t("Unknown author");
}

function relativeTime(date: number, now: number): string {
  const elapsed = Math.max(0, now - date);
  for (const [seconds, ago] of relativeUnits) {
    if (elapsed >= seconds) {
      return ago(Math.floor(elapsed / seconds));
    }
  }
  return t("just now");
}

function truncateSubject(subject: string): string {
  const line = firstLine(subject);
  const parts = Array.from(graphemes.segment(line), ({ segment }) => segment);
  return parts.length > SUBJECT_MAX_GRAPHEMES
    ? parts.slice(0, SUBJECT_MAX_GRAPHEMES).join("") + "…"
    : line;
}

function firstLine(subject: string): string {
  return (subject.split(/[\r\n]/, 1)[0] ?? "").trim();
}
