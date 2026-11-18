import { decodeLinkPath, withoutNoteExtension } from "../../shared/vault-path";
import { MAX_KNOWN_NOTES } from "./protocol";
import type { VaultIndex } from "../vault/api";

/** Decode once and reject ambiguous paths before the host resolves a target. */
export function linkParts(href: string): { path: string; fragment: string } {
  const clean = href.split("|")[0]!;
  const hash = clean.indexOf("#");
  const path = decodeURIComponent(hash < 0 ? clean : clean.slice(0, hash));
  const fragment = hash < 0 ? "" : clean.slice(hash + 1);
  if (
    [...path].some((char) => char.charCodeAt(0) < 32 || char === "\\") ||
    /%2f|%5c/i.test(path)
  ) {
    throw new Error("Invalid link path");
  }
  return { path, fragment };
}
export function externalScheme(href: string): string | undefined {
  return /^([a-z][a-z\d+.-]*):/i.exec(href)?.[1]?.toLowerCase();
}

/**
 * A link target's key in the host's unresolved / known-notes sets: the path
 * without its `#subpath` or a note's `.md` (as Obsidian names it), lower-cased
 * because links resolve regardless of case. Markdown destinations are
 * percent-decoded so keys match vault paths (e.g. fullwidth CJK names).
 */
export function unresolvedKey(href: string): string {
  const clean = href.split("|")[0]!;
  const hash = clean.indexOf("#");
  const path = decodeLinkPath(hash < 0 ? clean : clean.slice(0, hash));
  return withoutNoteExtension(path).toLowerCase();
}

/**
 * The file the vault index picks for a wikilink. Markdown links return
 * `undefined` so navigation resolves them against the file system: `./` and
 * `../` from the source note, a leading `/` from the vault root.
 */
export function openedVaultTarget(
  vault: Pick<VaultIndex, "resolveLink">,
  path: string,
  source: string,
  wiki: boolean,
): string | undefined {
  if (!wiki) {
    return undefined;
  }
  return vault.resolveLink(path, source, "wikilink")?.uri;
}

/**
 * Keys the webview can match against `unresolvedKey` for optimistic dimming
 * before the open note is re-indexed: each note's path without `.md`, its
 * Obsidian lookup basename, and its aliases — all lower-cased.
 */
export function knownNoteKeys(vault: VaultIndex): string[] {
  const keys = new Set<string>();
  for (const file of vault.files()) {
    if (file.extension !== "md" || file.excluded) {
      continue;
    }
    keys.add(withoutNoteExtension(file.path).toLowerCase());
    // Basename is already the Obsidian lookup key for .md notes.
    keys.add(file.basename.toLowerCase());
    for (const alias of vault.metadata(file.path)?.aliases ?? []) {
      const name = alias.trim().toLowerCase();
      if (name.length > 0) {
        keys.add(name);
      }
    }
  }
  return [...keys].sort().slice(0, MAX_KNOWN_NOTES);
}

/**
 * Whether an unresolved Markdown destination may create a note on click.
 * Basename-only note paths (`Note`, `Note.md`) match Obsidian; relative
 * paths (`./x`, `folder/x`) keep open-only so source-relative lookup stays
 * correct when `navigation.resolve` prefers the vault root under `create`.
 */
export function mayCreateNote(path: string): boolean {
  if (
    !path ||
    path.includes("/") ||
    path.includes("\\") ||
    path === "." ||
    path === ".."
  ) {
    return false;
  }
  const dot = path.lastIndexOf(".");
  if (dot <= 0) {
    return true;
  }
  const ext = path.slice(dot + 1).toLowerCase();
  return ext === "md" || ext === "markdown";
}
