import type { PickItem } from "../../shared/host";
import { safeRelative } from "../../shared/workspace-path";
import type { VaultFile } from "../vault/api";

/** The configured folder as a vault path, or undefined when it is unset or escapes. */
export function templateFolder(setting: string): string | undefined {
  return safeRelative(setting.trim().replace(/^\/+/, ""));
}

/** Markdown files anywhere under `folder`, sorted by path. */
export function templateFiles(
  files: readonly VaultFile[],
  folder: string,
): VaultFile[] {
  const prefix = `${folder}/`;
  return files
    .filter((file) => file.extension === "md" && file.path.startsWith(prefix))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** Picker rows named by their path inside the folder, filtered by `query`. */
export function templatePickItems(
  files: readonly VaultFile[],
  folder: string,
  query: string,
): PickItem<VaultFile>[] {
  const needle = query.trim().toLowerCase();
  return files
    .map((file) => ({
      label: file.path.slice(folder.length + 1).replace(/\.md$/i, ""),
      value: file,
    }))
    .filter((item) => item.label.toLowerCase().includes(needle));
}
