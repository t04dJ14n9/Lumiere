import type { HostWorkspace } from "../../shared/host";
import { joinContained } from "../../shared/workspace-path";

function parseEnabledSnippets(
  raw: string | undefined,
): readonly string[] | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return undefined;
    }
    const list = (parsed as Record<string, unknown>)["enabledCssSnippets"];
    if (!Array.isArray(list)) {
      return undefined;
    }
    return list.filter(
      (item): item is string =>
        typeof item === "string" && item.trim().length > 0,
    );
  } catch {
    return undefined;
  }
}

async function authorizeAndReadText(
  workspace: HostWorkspace,
  vaultRoot: string,
  uri: string,
): Promise<string | undefined> {
  try {
    if (workspace.files.authorize) {
      await workspace.files.authorize(vaultRoot, uri);
    }
    return await workspace.files.readText(uri);
  } catch {
    return undefined;
  }
}

/**
 * The snippet files `enabledCssSnippets` names. As in Obsidian, a snippet
 * loads only once it is switched on: no `appearance.json`, or no list in
 * it, loads none, however many `.css` files the folder holds.
 */
function resolveSnippetFiles(
  enabled: readonly string[] | undefined,
): readonly string[] {
  if (!enabled) {
    return [];
  }
  const files: string[] = [];
  for (const entry of enabled) {
    const clean = entry.trim().replace(/\.css$/i, "");
    if (
      clean &&
      !clean.includes("/") &&
      !clean.includes("\\") &&
      !clean.startsWith(".")
    ) {
      files.push(`${clean}.css`);
    }
  }
  return files;
}

export async function loadVaultCssSnippets(
  workspace: HostWorkspace,
  vaultRoot: string,
  configFolder = ".obsidian",
): Promise<readonly string[]> {
  if (/^([A-Za-z][A-Za-z0-9+.-]*:|[/\\])/.test(configFolder)) {
    return [];
  }
  const configDir = joinContained(vaultRoot, configFolder);
  if (!configDir) {
    return [];
  }
  const snippetsDir = joinContained(configDir, "snippets");
  if (!snippetsDir) {
    return [];
  }
  const appearanceUri = joinContained(configDir, "appearance.json");
  const appearanceRaw = appearanceUri
    ? await authorizeAndReadText(workspace, vaultRoot, appearanceUri)
    : undefined;
  const filenames = resolveSnippetFiles(parseEnabledSnippets(appearanceRaw));
  const results: string[] = [];
  for (const filename of filenames) {
    const uri = joinContained(snippetsDir, filename);
    if (!uri) {
      continue;
    }
    const css = await authorizeAndReadText(workspace, vaultRoot, uri);
    if (css && css.trim().length > 0) {
      results.push(css);
    }
  }
  return results;
}
