/**
 * The window's page (`shell/index.html`). It is the only response that carries
 * the shell key (auth.ts `fromShell`), and only to a load of the page itself.
 */
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import * as path from "node:path";
import { SHELL_KEY_META } from "../shared/shell-key";
import { mayReceiveShellKey } from "./auth";

const KEY_META = new RegExp(`(<meta name="${SHELL_KEY_META}" content=")(")`);

export async function serveShellPage(
  req: IncomingMessage,
  res: ServerResponse,
  shell: string,
  key: string,
): Promise<void> {
  const html = await readFile(path.join(shell, "index.html"), "utf8").catch(
    () => undefined,
  );
  if (html === undefined) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    // The key lasts as long as the server: a stale copy would carry a dead one.
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(
    mayReceiveShellKey(req) ? html.replace(KEY_META, `$1${key}$2`) : html,
  );
}
