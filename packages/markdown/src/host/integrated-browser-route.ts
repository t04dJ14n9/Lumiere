import * as vscode from "vscode";
import type { Logger } from "@workshop/core";
import type { OpenPlace } from "../shared/host";
import { isHtmlPath } from "../shared/html-file";

/**
 * VS Code's "Open in Integrated Browser" for a file: it takes the file's URI
 * and opens an `.html` page in the browser view, which reloads it as the file
 * changes. It is a workbench command, not an API: Cursor and older VS Code
 * builds do not have it (found by `integratedBrowserCommands`).
 */
export const BROWSER_OPEN_FILE_COMMAND = "workbench.action.browser.openFile";
/** Opens a URL in the Integrated Browser: a string, or `{ url, openToSide }`. */
export const BROWSER_OPEN_COMMAND = "workbench.action.browser.open";

/** Which of the two this window has. */
export interface BrowserCommands {
  readonly openFile: boolean;
  readonly open: boolean;
}

/** How long a window without the command is believed before it is asked again. */
const ABSENT_FOR_MS = 30_000;

let known: (BrowserCommands & { readonly checkedAt: number }) | undefined;

/**
 * Whether the Integrated Browser's commands exist, asked of VS Code
 * (`commands.getCommands`) and remembered: a window that has them keeps them
 * for good, and one that does not is asked again after 30 seconds, since the
 * workbench registers its commands as it starts.
 */
export async function integratedBrowserCommands(
  now: () => number = Date.now,
): Promise<BrowserCommands> {
  if (known && (known.openFile || now() - known.checkedAt < ABSENT_FOR_MS)) {
    return known;
  }
  const commands = new Set(await vscode.commands.getCommands(true));
  known = {
    openFile: commands.has(BROWSER_OPEN_FILE_COMMAND),
    open: commands.has(BROWSER_OPEN_COMMAND),
    checkedAt: now(),
  };
  return known;
}

/**
 * Show an HTML file in VS Code's Integrated Browser. False for any other file,
 * when the caller asked for text, in Restricted Mode (a page must never run
 * there), when this window has no such command (Cursor, an older build), and
 * when the command refuses the file: it then opens as text, as every other
 * file does, with the options the link was opened with (a kept tab, the focus,
 * the group). The caller has already checked that the file is in the vault.
 * Open to the Side asks `browser.open` for the group beside, where the window
 * has it, and otherwise gets the file's own command.
 */
export async function openedInIntegratedBrowser(
  uri: vscode.Uri,
  request: { place: OpenPlace; asText?: boolean; logger: Logger },
): Promise<boolean> {
  if (request.asText || !isHtmlPath(uri.path) || !vscode.workspace.isTrusted) {
    return false;
  }
  const commands = await integratedBrowserCommands();
  if (!commands.openFile) {
    return false;
  }
  if (request.place === "side" && commands.open) {
    try {
      await vscode.commands.executeCommand(BROWSER_OPEN_COMMAND, {
        url: uri.toString(),
        openToSide: true,
      });
      return true;
    } catch (error) {
      request.logger.debug("Integrated Browser refused the side open", error);
    }
  }
  try {
    await vscode.commands.executeCommand(BROWSER_OPEN_FILE_COMMAND, uri);
    return true;
  } catch (error) {
    request.logger.warn("Integrated Browser refused the file", error);
    return false;
  }
}
