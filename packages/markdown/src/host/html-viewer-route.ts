import * as vscode from "vscode";
import { isHtmlPath } from "../shared/html-file";
import { contributionId } from "../shared/setting-schema";

/**
 * The HTML viewer's command (plugins/htmlViewer): open a vault's HTML file as
 * a page in a tab of its own. It is the plugin that decides whether the file
 * may be shown (a trusted workspace) and refuses what is outside the vault;
 * this only hands the file over, with the vault it was linked from.
 */
export const HTML_VIEWER_COMMAND = contributionId("htmlViewer.open");

/**
 * Hand an HTML file to the viewer. False for any other file, when the caller
 * asked for text, in Restricted Mode, and when there is no viewer to hand it to
 * (the plugin is turned off): it then opens as text, as every other file does,
 * with the options the link was opened with (a kept tab, the focus, the group).
 * The viewer's own Restricted Mode branch is for callers that run its command.
 */
export async function openedInHtmlViewer(
  uri: vscode.Uri,
  request: { root: string; asText?: boolean },
  column: vscode.ViewColumn,
): Promise<boolean> {
  if (request.asText || !isHtmlPath(uri.path) || !vscode.workspace.isTrusted) {
    return false;
  }
  const commands = await vscode.commands.getCommands(true);
  if (!commands.includes(HTML_VIEWER_COMMAND)) {
    return false;
  }
  await vscode.commands.executeCommand(
    HTML_VIEWER_COMMAND,
    uri.toString(),
    request.root,
    { viewColumn: column },
  );
  return true;
}
