import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type { LumiereHost } from "@workshop/host-node";
import type { DshContext } from "../../src/host/dsh";
import {
  registerSessionWorkspace,
  sessionWorkspace,
} from "../../src/host/workspace";
import { dshSessions, type Sessions } from "./fake-sessions";

const context = (known: Sessions) => dshSessions(known) as DshContext;

function recordingHost(): { host: LumiereHost; added: string[] } {
  const added: string[] = [];
  const host = {
    addRoot: (uri: string) => added.push(uri),
  } as unknown as LumiereHost;
  return { host, added };
}

async function folder(t: test.TestContext): Promise<string> {
  const dir = await realpath(
    await mkdtemp(path.join(tmpdir(), "lumiere-dsh-workspace-")),
  );
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("a session's workspace is its header's cwd, live or stored", async () => {
  const ctx = context({
    live: { live: "/work/live", bare: undefined },
    stored: { cold: "/work/cold" },
  });
  assert.equal(await sessionWorkspace(ctx, "live"), "/work/live");
  assert.equal(await sessionWorkspace(ctx, "cold"), "/work/cold");
  assert.equal(await sessionWorkspace(ctx, "bare"), undefined);
  assert.equal(await sessionWorkspace(ctx, "unknown"), undefined);
  assert.equal(
    await sessionWorkspace(
      context({ stored: { cold: "/work/cold" }, noPersistence: true }),
      "cold",
    ),
    undefined,
    "without persistence a stored session is unknown",
  );
});

test("the workspace of a live or a stored session is registered", async (t) => {
  const live = await folder(t);
  const stored = await folder(t);
  const ctx = context({ live: { a: live }, stored: { b: stored } });
  const { host, added } = recordingHost();
  await registerSessionWorkspace(ctx, host, "a");
  await registerSessionWorkspace(ctx, host, "b");
  assert.deepEqual(added, [
    pathToFileURL(live).toString(),
    pathToFileURL(stored).toString(),
  ]);
});

test("a workspace reached through a symbolic link is registered by its real path", async (t) => {
  const dir = await folder(t);
  const real = path.join(dir, "real");
  const link = path.join(dir, "link");
  await mkdir(real);
  try {
    await symlink(real, link);
  } catch {
    t.skip("creating symlinks is not supported on this platform");
    return;
  }
  const { host, added } = recordingHost();
  await registerSessionWorkspace(context({ live: { a: link } }), host, "a");
  assert.deepEqual(added, [pathToFileURL(real).toString()]);
});

test("nothing is registered for a session DSH does not know or cannot place", async (t) => {
  const dir = await folder(t);
  const ctx = context({
    live: {
      bare: undefined,
      relative: "work/notes",
      missing: path.join(dir, "gone"),
      root: path.parse(dir).root,
    },
    stored: { cold: dir },
    noPersistence: true,
  });
  const { host, added } = recordingHost();
  for (const id of ["unknown", "bare", "relative", "missing", "root", "cold"]) {
    await registerSessionWorkspace(ctx, host, id);
  }
  assert.deepEqual(added, []);
});
