import { linkLocation } from "../../shared/link-location";
import { folderOf, joinVaultPath } from "../../shared/vault-path";
import type { VaultFile, VaultIndex } from "../vault/api";

/**
 * The file a Markdown link's path names, found as following the link finds
 * it: from the note's folder or the vault root, in `linkLocation`'s order
 * (so a bare `progress.md` is the one beside the note, not another note's of
 * the same name), then as the vault resolves any Markdown link, which also
 * finds a path written without `.md`.
 */
export function destinationFile(
  vault: VaultIndex,
  written: string,
  source: string,
): VaultFile | undefined {
  const { relative, folders } = linkLocation(written);
  for (const folder of folders) {
    const path = joinVaultPath(
      folder === "vault" ? "" : folderOf(source),
      relative,
    );
    const file = path ? vault.file(path) : undefined;
    if (file) {
      return file;
    }
  }
  return vault.resolveLink(written, source, "markdown");
}
