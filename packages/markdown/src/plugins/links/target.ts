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
 * before the open note is re-indexed, all lower-cased: a note's basename and
 * its aliases, and any other file's name with its extension. Links resolve
 * to attachments (`[[paper.pdf]]`) and to excluded files too, so leaving
 * those out dimmed links that work. A link with a folder (`Folder/Note`)
 * matches on its last segment (`isUnresolved`), so paths are not listed.
 *
 * Past `MAX_KNOWN_NOTES` the list is empty rather than cut short: a missing
 * key would dim a link to a file that exists, while an empty list only turns
 * the optimistic dimming off until the vault's own unresolved set arrives.
 */
export function knownNoteKeys(vault: VaultIndex): string[] {
  const keys = new Set<string>();
  for (const file of vault.files()) {
    if (!/^(?:md|markdown)$/i.test(file.extension)) {
      keys.add(file.path.slice(file.path.lastIndexOf("/") + 1).toLowerCase());
      continue;
    }
    keys.add(file.basename.toLowerCase());
    for (const alias of vault.metadata(file.path)?.aliases ?? []) {
      const name = alias.trim().toLowerCase();
      if (name.length > 0) {
        keys.add(name);
      }
    }
  }
  return keys.size > MAX_KNOWN_NOTES ? [] : [...keys].sort();
}

/**
 * Whether an unresolved Markdown destination may create a note on click.
 * Basename-only note paths (`Note`, `Note.md`) match Obsidian; relative
 * paths (`./x`, `folder/x`) keep open-only. Creating is a last resort and
 * never changes which existing file a link names: `navigation.resolve`
 * looks for that first, the same way for either answer.
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
