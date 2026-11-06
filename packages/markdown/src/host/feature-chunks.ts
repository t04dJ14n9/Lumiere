import { readFileSync } from "node:fs";
import * as path from "node:path";
import type * as vscode from "vscode";
import { features } from "../plugins/catalog";
import { firstViewFiles, type FeatureChunks } from "../shared/first-view";

let cached: readonly string[] | undefined;

/**
 * What the editor page may fetch right after its entry, as paths under
 * dist/markdown: the entry itself, then the chunks of the first-view
 * features that are on by default (the build writes their lists to
 * webview/feature-chunks.json). Empty when the build has no such list, so the
 * page then just loads them as it needs them.
 */
export function firstViewPreload(extensionUri: vscode.Uri): readonly string[] {
  cached ??= readFirstViewPreload(extensionUri);
  return cached;
}

/** `firstViewPreload` without remembering the answer. */
export function readFirstViewPreload(
  extensionUri: Pick<vscode.Uri, "fsPath">,
): readonly string[] {
  try {
    const file = path.join(
      extensionUri.fsPath,
      "dist",
      "markdown",
      "webview",
      "feature-chunks.json",
    );
    const chunks = JSON.parse(readFileSync(file, "utf8")) as FeatureChunks;
    const onByDefault = new Set(
      features
        .filter(
          (manifest) =>
            manifest.defaultEnabled && manifest.surfaces.includes("webview"),
        )
        .map((manifest) => manifest.id),
    );
    return [
      "webview/editor.js",
      ...firstViewFiles(chunks, (id) => onByDefault.has(id)),
    ];
  } catch {
    return [];
  }
}
