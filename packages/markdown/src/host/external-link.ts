import type * as vscode from "vscode";

/**
 * Open a web link as written. `Uri.parse` percent-decodes the URL, and VS
 * Code then opens `encodeURI(uri.toString(true))`, which leaves `%2F`, `%26`
 * or `%3D` decoded: a different URL. Given the string itself, VS Code opens
 * that string (its `openUri` takes one, though the API's type names `Uri`).
 */
export function openExternalLink(
  env: Pick<typeof vscode.env, "openExternal">,
  href: string,
): Thenable<boolean> {
  return env.openExternal(href as unknown as vscode.Uri);
}
