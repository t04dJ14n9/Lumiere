/**
 * The workspace a DSH session works in: the only folder its pages may open
 * notes from. A page names the session (`?session=`), never the folder; the
 * folder is read from DSH, as DSH's own file service reads it
 * (`@deepseek-ai/dsh-api-workspace-files` resolves a session's files from its
 * header's `cwd`, live in `ctx.sessions` or stored in `ctx.sessionPersistence`).
 */
import { realpath } from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type { LumiereHost } from "@workshop/host-node";
import type { DshContext } from "./dsh";

/** The session's working directory as DSH records it; undefined when DSH does not know the session. */
export async function sessionWorkspace(
  ctx: DshContext,
  sessionId: string,
): Promise<string | undefined> {
  const live = ctx.sessions.get(sessionId)?.header;
  const header =
    live ?? (await ctx.get("sessionPersistence")?.stat(sessionId))?.header;
  return header?.cwd;
}

/**
 * Register the workspace of the session a page request names, so host-node
 * serves pages from it and from nowhere else. It is registered by its real
 * path, which is how host-node compares: through a symbolic link it would
 * never match. A filesystem root is not registered: every folder is inside it.
 */
export async function registerSessionWorkspace(
  ctx: DshContext,
  host: LumiereHost,
  sessionId: string,
): Promise<void> {
  const cwd = await sessionWorkspace(ctx, sessionId);
  if (!cwd || !path.isAbsolute(cwd)) {
    return;
  }
  const real = await realpath(cwd).catch(() => undefined);
  if (real && real !== path.parse(real).root) {
    host.addRoot(pathToFileURL(real).toString());
  }
}
