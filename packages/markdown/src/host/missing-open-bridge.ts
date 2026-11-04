/**
 * Named untitled bridge for opening a missing Markdown `file:` path in Lumia
 * without creating the workspace file until Save.
 *
 * Tab title before Save comes from the untitled URI path ending in the
 * intended basename (e.g. `untitled:/…/test.md` → tab `test.md`).
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as vscode from "vscode";
import { MARKDOWN_EDITOR } from "../shared/editor-provider";

type AbsentOnDisk = (fileUri: string) => boolean;

function defaultMarkdownAbsentOnDisk(fileUri: string): boolean {
  try {
    return !existsSync(fileURLToPath(fileUri));
  } catch {
    // Non-file or unparseable URI: let openWith decide.
    return false;
  }
}

let markdownAbsentOnDisk: AbsentOnDisk = defaultMarkdownAbsentOnDisk;

/** Test-only override; call with no args to restore the real disk check. */
export function setMarkdownAbsentOnDiskForTests(check?: AbsentOnDisk): void {
  markdownAbsentOnDisk = check ?? defaultMarkdownAbsentOnDisk;
}

/** True when a file: Markdown URI has no backing path on disk. */
export function isMarkdownAbsentOnDisk(fileUri: string): boolean {
  return isMissingMarkdownFileUri(fileUri) && markdownAbsentOnDisk(fileUri);
}

/** file: Markdown notes that may use the missing-open bridge. */
export function isMissingMarkdownFileUri(uri: string): boolean {
  return /^file:/i.test(uri) && /\.(md|markdown)$/i.test(uriPath(uri));
}

/** Basename used for the editor tab title (decoded). */
export function basenameForIntendedFileUri(uri: string): string {
  const path = uriPath(uri);
  const slash = path.lastIndexOf("/");
  const name = slash < 0 ? path : path.slice(slash + 1);
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

/**
 * Untitled URI whose path ends with the intended basename so the tab label
 * is that basename (never `Untitled-N`). Full path associates Save with the
 * intended workspace location.
 */
export function untitledBridgeUriFor(intendedFileUri: string): string {
  if (!isMissingMarkdownFileUri(intendedFileUri)) {
    throw new Error("missing-open bridge requires a file Markdown URI");
  }
  const path = uriPath(intendedFileUri);
  return `untitled:${path.startsWith("/") ? path : `/${path}`}`;
}

/** Maps bridge document URI → intended workspace `file:` URI. */
export class MissingOpenBridge {
  readonly #intended = new Map<string, string>();

  remember(bridgeUri: string, intendedFileUri: string): void {
    if (!isMissingMarkdownFileUri(intendedFileUri)) {
      throw new Error("missing-open bridge intended URI must be Markdown");
    }
    this.#intended.set(bridgeUri, intendedFileUri);
  }

  peek(bridgeUri: string): string | undefined {
    return this.#intended.get(bridgeUri);
  }

  /** Read and clear the intended path for a bridge document (Save path). */
  take(bridgeUri: string): string | undefined {
    const intended = this.#intended.get(bridgeUri);
    if (intended !== undefined) {
      this.#intended.delete(bridgeUri);
    }
    return intended;
  }

  clear(bridgeUri: string): void {
    this.#intended.delete(bridgeUri);
  }
}

/** Shared bridge map for reclaim catch + Save swap. */
export const missingOpenBridge = new MissingOpenBridge();

export function isFileNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return false;
  }
  return error.code === "FileNotFound" || error.code === "ENOENT";
}

/** Host surface used to open the named untitled bridge in Lumia. */
export interface MissingOpenBridgeHost {
  openTextDocument(uri: string): Promise<void>;
  openWith(
    uri: string,
    viewType: string,
    options?: { viewColumn?: number; preview?: boolean },
  ): Promise<void>;
}

/**
 * Open an empty named untitled document in Lumia and remember the intended
 * `file:` path for Save. Does not create the workspace file.
 */
export async function openBridgeForMissingMarkdown(options: {
  intendedFileUri: string;
  viewType: string;
  viewColumn?: number;
  preview?: boolean;
  bridge: MissingOpenBridge;
  host: MissingOpenBridgeHost;
}): Promise<string> {
  const { intendedFileUri, viewType, bridge, host } = options;
  if (!isMissingMarkdownFileUri(intendedFileUri)) {
    throw new Error("missing-open bridge requires a file Markdown URI");
  }
  const bridgeUri = untitledBridgeUriFor(intendedFileUri);
  await host.openTextDocument(bridgeUri);
  bridge.remember(bridgeUri, intendedFileUri);
  await host.openWith(bridgeUri, viewType, {
    ...(options.viewColumn !== undefined
      ? { viewColumn: options.viewColumn }
      : {}),
    ...(options.preview !== undefined ? { preview: options.preview } : {}),
  });
  return bridgeUri;
}

/** Host surface used to persist a bridge document onto its intended path. */
export interface MissingOpenPersistHost {
  ensureParentDir(fileUri: string): Promise<void>;
  writeText(fileUri: string, content: string): Promise<void>;
  openWith(
    uri: string,
    viewType: string,
    options?: { viewColumn?: number; preview?: boolean },
  ): Promise<void>;
  closeUri(uri: string): Promise<void>;
}

/**
 * Write bridge content to the intended `file:` path, open Lumia there, and
 * close the untitled bridge. Creates parent directories when needed.
 */
export async function persistMissingOpenBridge(options: {
  bridgeUri: string;
  content: string;
  bridge: MissingOpenBridge;
  viewType: string;
  host: MissingOpenPersistHost;
}): Promise<string | undefined> {
  const intended = options.bridge.take(options.bridgeUri);
  if (intended === undefined) {
    return undefined;
  }
  await options.host.ensureParentDir(intended);
  await options.host.writeText(intended, options.content);
  await options.host.openWith(intended, options.viewType);
  await options.host.closeUri(options.bridgeUri);
  return intended;
}

function vscodePersistHost(): MissingOpenPersistHost {
  return {
    async ensureParentDir(fileUri) {
      const file = vscode.Uri.parse(fileUri);
      const parent = vscode.Uri.joinPath(file, "..");
      await vscode.workspace.fs.createDirectory(parent);
    },
    async writeText(fileUri, content) {
      await vscode.workspace.fs.writeFile(
        vscode.Uri.parse(fileUri),
        new TextEncoder().encode(content),
      );
    },
    async openWith(uri, type, options) {
      await vscode.commands.executeCommand(
        "vscode.openWith",
        vscode.Uri.parse(uri),
        type,
        options,
      );
    },
    async closeUri(uri) {
      for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
          const input = tab.input as { uri?: vscode.Uri } | undefined;
          if (input?.uri?.toString() === uri && !tab.isDirty) {
            await vscode.window.tabGroups.close(tab, true);
            return;
          }
        }
      }
      const doc = vscode.workspace.textDocuments.find(
        (document) => document.uri.toString() === uri,
      );
      if (doc) {
        await vscode.window.showTextDocument(doc, {
          preview: true,
          preserveFocus: true,
        });
        await vscode.commands.executeCommand(
          "workbench.action.revertAndCloseActiveEditor",
        );
      }
    },
  };
}

/**
 * On Save of a mapped untitled bridge: write the intended path, open Lumia on
 * the real file, and close the bridge tab.
 */
export function registerMissingOpenBridgeSave(
  bridge: MissingOpenBridge = missingOpenBridge,
  viewType: string = MARKDOWN_EDITOR.viewType,
): vscode.Disposable {
  // Unit fakes may omit willSave; skip registration rather than throw.
  if (typeof vscode.workspace.onWillSaveTextDocument !== "function") {
    return { dispose() {} };
  }
  return vscode.workspace.onWillSaveTextDocument((event) => {
    const bridgeUri = event.document.uri.toString();
    if (!bridge.peek(bridgeUri)) {
      return;
    }
    const content = event.document.getText();
    event.waitUntil(
      persistMissingOpenBridge({
        bridgeUri,
        content,
        bridge,
        viewType,
        host: vscodePersistHost(),
      }).then(() => undefined),
    );
  });
}

function uriPath(uri: string): string {
  // Strip scheme://authority so path-only checks work for file: and untitled:.
  const withoutScheme = uri.replace(/^[a-z][a-z0-9+.-]*:/i, "");
  if (withoutScheme.startsWith("//")) {
    const rest = withoutScheme.slice(2);
    const slash = rest.indexOf("/");
    return slash < 0 ? "" : rest.slice(slash);
  }
  return withoutScheme.startsWith("/") ? withoutScheme : `/${withoutScheme}`;
}
