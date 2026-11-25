import type { DiffSide } from "../../shared/git";
import { t } from "@workshop/l10n";

/** The last path segment, without query or fragment (no regex on the URI). */
export function fileName(uri: string): string {
  const query = uri.search(/[?#]/);
  const path = query < 0 ? uri : uri.slice(0, query);
  const name = path.slice(path.lastIndexOf("/") + 1);
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

/** "HEAD", "Index" or "Working tree", from a git: URI's query or its scheme. */
export function sideLabel(uri: string): string {
  if (!isGitUri(uri)) {
    return t("Working tree");
  }
  try {
    const query = decodeURIComponent(uri.slice(uri.indexOf("?") + 1));
    const ref = (JSON.parse(query) as { ref?: string }).ref ?? "";
    if (ref === "" || ref === "~") {
      return t("Index");
    }
    return /^[0-9a-f]{40}$/.test(ref) ? ref.slice(0, 7) : ref;
  } catch {
    return "Git";
  }
}

function isGitUri(uri: string): boolean {
  return uri.startsWith("git:");
}

/**
 * Labels for a comparison. A plain-file pair (Compare, `code --diff`) must not
 * both read "Working tree" — that made both sides look like the live buffer.
 */
export function sideLabels(
  original: string,
  modified: string,
): { left: string; right: string } {
  const left = sideLabel(original);
  const right = sideLabel(modified);
  // Both sides are files, not git snapshots (the labels are translated, so
  // they cannot be compared with the English text).
  if (isGitUri(original) || isGitUri(modified)) {
    return { left, right };
  }
  const a = fileName(original);
  const b = fileName(modified);
  if (!a || !b || a === b) {
    return { left: t("Original"), right: t("Modified") };
  }
  return { left: a, right: b };
}

/** Stamp comparison labels onto already-read sides. */
export function applySideLabels(
  original: string,
  modified: string,
  left: DiffSide,
  right: DiffSide,
): { left: DiffSide; right: DiffSide } {
  const labels = sideLabels(original, modified);
  return {
    left: { ...left, label: labels.left },
    right: { ...right, label: labels.right },
  };
}
