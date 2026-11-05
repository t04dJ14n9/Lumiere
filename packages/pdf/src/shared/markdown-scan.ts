/**
 * Which Markdown files the backlink index scans: the notes of the vault.
 */

/** `.md` and `.markdown`: both are notes to the Markdown editor. */
export const MARKDOWN_GLOB = "**/*.{md,markdown}";

export function isMarkdownPath(path: string): boolean {
  return /\.(?:md|markdown)$/iu.test(path);
}

/** Folders that hold other people's Markdown, never the user's notes. */
const DEPENDENCY_FOLDERS = ["**/node_modules/**", "**/.git/**"];

/**
 * The `exclude` for `findFiles` in one workspace folder. VS Code applies
 * `files.exclude` only when `exclude` is `undefined`; any pattern replaces
 * it. So the setting is read and joined with the dependency folders into the
 * one pattern `findFiles` takes, and what the user hid stays hidden.
 *
 * `value` is the setting as VS Code gives it: an object from glob to `true`
 * (hidden), `false` (shown) or `{ when }`. A `when` condition cannot be
 * written as a glob, so such an entry is left out, as is one switched off.
 */
export function scanExclude(value: unknown): string {
  const hidden =
    typeof value === "object" && value !== null
      ? Object.entries(value)
          .filter(([, enabled]) => enabled === true)
          .map(([glob]) => glob)
      : [];
  return `{${[...DEPENDENCY_FOLDERS, ...hidden].join(",")}}`;
}
