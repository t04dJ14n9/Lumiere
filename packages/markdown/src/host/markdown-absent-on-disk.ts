/**
 * Detect missing workspace Markdown `file:` paths so reclaim can leave the
 * built-in Text Editor alone (product lock 2026-11-04: no Lumia openWith /
 * untitled bridge for absent notes).
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

type AbsentOnDisk = (fileUri: string) => boolean;

function defaultMarkdownAbsentOnDisk(fileUri: string): boolean {
  try {
    return !existsSync(fileURLToPath(fileUri));
  } catch {
    // Non-file or unparseable URI: treat as present so reclaim can proceed.
    return false;
  }
}

let markdownAbsentOnDisk: AbsentOnDisk = defaultMarkdownAbsentOnDisk;

/** Test-only override; call with no args to restore the real disk check. */
export function setMarkdownAbsentOnDiskForTests(check?: AbsentOnDisk): void {
  markdownAbsentOnDisk = check ?? defaultMarkdownAbsentOnDisk;
}

/** file: Markdown note URI (path ends in .md / .markdown). */
export function isMarkdownFileUri(uri: string): boolean {
  return /^file:/i.test(uri) && /\.(md|markdown)$/i.test(uriPath(uri));
}

/** True when a file: Markdown URI has no backing path on disk. */
export function isMarkdownAbsentOnDisk(fileUri: string): boolean {
  return isMarkdownFileUri(fileUri) && markdownAbsentOnDisk(fileUri);
}

function uriPath(uri: string): string {
  const withoutScheme = uri.replace(/^[a-z][a-z0-9+.-]*:/i, "");
  if (withoutScheme.startsWith("//")) {
    const rest = withoutScheme.slice(2);
    const slash = rest.indexOf("/");
    return slash < 0 ? "" : rest.slice(slash);
  }
  return withoutScheme.startsWith("/") ? withoutScheme : `/${withoutScheme}`;
}
