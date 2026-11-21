import { readdir, readFile, rm } from "node:fs/promises";
import * as net from "node:net";
import * as path from "node:path";

/** How long a port gets to answer before it counts as taken, not free. */
const PROBE_MS = 1000;

/** What the sweep asks the system; tests replace each. */
export interface SweepOptions {
  /** Whether no process has this id. */
  isGone?: (pid: number) => boolean;
  /** Whether nothing listens on this loopback port. */
  refuses?: (port: number) => Promise<boolean>;
  /**
   * The port the sweeping bridge itself listens on. Only one process can
   * listen there, so any other file naming it is stale.
   */
  heldPort?: number;
}

/**
 * Remove the discovery files of bridges whose window is gone. A window
 * removes its own file when the bridge stops, but not when it crashes or
 * is killed; the shim skips such files, yet they pile up. A file goes when
 * the process it names no longer exists, or when nothing listens on its
 * port any more: after a reboot another program can run under the old
 * process id, and the shim would then count the file as a second window
 * with the same folder. A bridge listens before it writes its file and
 * removes the file before it stops listening, so a live one always
 * answers. A file that names the port the sweeping bridge itself listens
 * on goes too: nothing else can listen there. A file that cannot be read
 * or parsed, whose process exists (even another user's) and whose port
 * answers (or cannot be told), is left.
 *
 * The file is removed by the name it was read under, after the probe has
 * answered, while other windows publish. That is safe only because no
 * publication ever reuses a name (see `announce`): that name is still the
 * stale record's, or nothing. A file named `<port>.json`, as an
 * earlier version wrote them, can still be replaced under a sweep by a
 * window of that version that gets the port; that lasts until it reloads.
 */
export async function sweepDiscoveryFiles(
  dir: string,
  options: SweepOptions = {},
): Promise<void> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith(".json"));
  } catch {
    return;
  }
  await Promise.all(
    names.map(async (name) => {
      const file = path.join(dir, name);
      const record = await readRecord(file);
      if (record && (await isStale(record, options))) {
        await rm(file, { force: true });
      }
    }),
  );
}

async function isStale(
  record: { pid: number; port: number | undefined },
  options: SweepOptions,
): Promise<boolean> {
  const { isGone = processIsGone, refuses = portRefuses, heldPort } = options;
  if (isGone(record.pid)) {
    return true;
  }
  if (record.port === undefined) {
    return false;
  }
  return record.port === heldPort || (await refuses(record.port));
}

async function readRecord(
  file: string,
): Promise<{ pid: number; port: number | undefined } | undefined> {
  try {
    const { pid, url } = JSON.parse(await readFile(file, "utf8")) as {
      pid?: unknown;
      url?: unknown;
    };
    if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
      return undefined;
    }
    return { pid, port: loopbackPort(url) };
  } catch {
    return undefined;
  }
}

/** The port of `http://127.0.0.1:<port>/…`, as the bridge writes its URL. */
function loopbackPort(url: unknown): number | undefined {
  if (typeof url !== "string") {
    return undefined;
  }
  try {
    const parsed = new URL(url);
    const port = Number(parsed.port);
    return parsed.hostname === "127.0.0.1" && Number.isInteger(port) && port > 0
      ? port
      : undefined;
  } catch {
    return undefined;
  }
}

/** Gone only when the system says there is no such process (ESRCH). */
function processIsGone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as { code?: unknown }).code === "ESRCH";
  }
}

/** Refused only when the system says nothing listens there (ECONNREFUSED). */
function portRefuses(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    const settle = (refused: boolean) => {
      socket.destroy();
      resolve(refused);
    };
    socket.setTimeout(PROBE_MS, () => settle(false));
    socket.once("connect", () => settle(false));
    socket.once("error", (error: NodeJS.ErrnoException) =>
      settle(error.code === "ECONNREFUSED"),
    );
  });
}
