import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import type { BridgeInfo } from "./constants";
import { sweepDiscoveryFiles } from "./discovery-sweep";
import type { BridgeLog } from "./server";

/** The window's workspace folders, as the shim compares them with its own. */
export function workspaceFolderPaths(): string[] {
  return (vscode.workspace.workspaceFolders ?? []).map(
    (folder) => folder.uri.fsPath,
  );
}

/**
 * The discovery file for the stdio shim (Claude Code, Codex, any MCP client).
 * The shim picks a window by the folders it names, so it follows the
 * window's folders: one added to the window, or removed from it, while the
 * bridge runs would otherwise send an agent there to another window, or to
 * none.
 */
export async function announce(
  info: BridgeInfo,
  where: {
    discoveryDir: string;
    port: number;
    undo: (() => unknown)[];
    log: BridgeLog;
  },
): Promise<void> {
  const { discoveryDir, port, undo, log } = where;
  const discoveryFile = path.join(discoveryDir, `${port}.json`);
  await mkdir(discoveryDir, { recursive: true, mode: 0o700 });
  await sweepDiscoveryFiles(discoveryDir);
  // VS Code ends a closing window's extension host a few milliseconds after
  // it asks the extensions to stop, long before this undo step's turn: the
  // file goes on `exit` too, which runs synchronously as the process ends.
  const removeOnExit = () => rmSync(discoveryFile, { force: true });
  process.once("exit", removeOnExit);
  undo.push(() => {
    process.off("exit", removeOnExit);
    return rm(discoveryFile, { force: true });
  });
  await writeDiscoveryFile(discoveryFile, info);
  let rewriting = Promise.resolve();
  const subscription = vscode.workspace.onDidChangeWorkspaceFolders(() => {
    const current = { ...info, workspaceFolders: workspaceFolderPaths() };
    rewriting = rewriting
      .then(() => writeDiscoveryFile(discoveryFile, current))
      .catch((error) =>
        log.warn(`Could not update the discovery file: ${describe(error)}`),
      );
  });
  // Undone before the file is removed, and after the last rewrite has
  // landed: a late rewrite would put back the file of a stopped bridge.
  undo.push(async () => {
    subscription.dispose();
    await rewriting;
  });
}

/**
 * Written whole or not at all: the shim reads every `.json` there, and a
 * half-written one would hide this window from it. The temporary name does
 * not end in `.json`.
 */
async function writeDiscoveryFile(file: string, info: BridgeInfo) {
  const temporary = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(info, null, 2), { mode: 0o600 });
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
