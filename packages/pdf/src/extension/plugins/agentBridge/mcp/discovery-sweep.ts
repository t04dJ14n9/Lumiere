import { readdir, readFile, rm } from "node:fs/promises";
import * as path from "node:path";

/**
 * Remove the discovery files of bridges whose window is gone. A window
 * removes its own file when the bridge stops, but not when it crashes or
 * is killed; the shim skips such files, yet they pile up. Only a file that
 * names a process that no longer exists goes: one that cannot be read or
 * parsed, or whose process exists (even another user's), is left.
 */
export async function sweepDiscoveryFiles(
  dir: string,
  isGone: (pid: number) => boolean = processIsGone,
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
      const pid = await recordPid(file);
      if (pid !== undefined && isGone(pid)) {
        await rm(file, { force: true });
      }
    }),
  );
}

async function recordPid(file: string): Promise<number | undefined> {
  try {
    const { pid } = JSON.parse(await readFile(file, "utf8")) as {
      pid?: unknown;
    };
    return typeof pid === "number" && Number.isInteger(pid) && pid > 0
      ? pid
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
