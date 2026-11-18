import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { MARKDOWN_EDITOR } from "@workshop/markdown/portable";
import { NoteDocuments, noteFiles } from "../../src/host/documents";
import { createNodePlatform } from "../../src/host/node-platform";
import { PanelHub } from "../../src/host/panels";
import type { HostFiles } from "../../src/host/platform";
import { watchVault } from "../../src/host/vault";

const NODE_NOTES = noteFiles(
  createNodePlatform({ data: tmpdir(), workers: "" }),
);

/** Rejections no one handled while `run` and a short settle ran. */
async function unhandledDuring(run: () => Promise<void>): Promise<unknown[]> {
  const unhandled: unknown[] = [];
  const record = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", record);
  try {
    await run();
    await new Promise((resolve) => setTimeout(resolve, 50));
  } finally {
    process.off("unhandledRejection", record);
  }
  return unhandled;
}

const throwing = () => {
  throw new Error("a listener failed");
};

test("a reload whose change listener throws is logged, not left unhandled", async (t) => {
  let disk = "start";
  let changed: () => void = () => {};
  const logged: string[] = [];
  const documents = new NoteDocuments(
    {
      ...NODE_NOTES,
      readText: async () => disk,
      watch: (_uri, listener) => {
        changed = listener;
        return () => {};
      },
    },
    60_000,
    (message) => logged.push(message),
  );
  t.after(() => documents.dispose());
  await documents.open("file:///v/Note.md");
  documents.onChange(throwing);
  const unhandled = await unhandledDuring(async () => {
    disk = "from outside";
    changed();
  });
  assert.deepEqual(unhandled, []);
  assert.match(logged.join("\n"), /a listener failed/);
});

test("a closed panel whose note's close listener throws is logged, not left unhandled", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "lumiere-unhandled-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, "Note.md"), "hello");
  const uri = pathToFileURL(path.join(dir, "Note.md")).toString();
  const documents = new NoteDocuments(NODE_NOTES, 60_000);
  t.after(() => documents.dispose());
  const logged: string[] = [];
  const hub = new PanelHub(documents, 60_000, (message) =>
    logged.push(message),
  );
  hub.register(MARKDOWN_EDITOR, (shell) => shell.setHTML("<html></html>"));
  const { id } = await hub.open({
    uri,
    urls: () => ({
      cspSource: "'self'",
      asset: (relative: string) => relative,
      resource: (target: string) => target,
    }),
  });
  documents.onClosed(throwing);
  const unhandled = await unhandledDuring(async () => {
    hub.get(id)?.dispose();
  });
  assert.deepEqual(unhandled, []);
  assert.match(logged.join("\n"), /a listener failed/);
});

test("a vault watch event whose listener throws is logged, not left unhandled", async () => {
  let report: (relative: string) => void = () => {};
  const files = {
    watchTree: (_root: string, listener: (relative: string) => void) => {
      report = listener;
      return () => {};
    },
    stat: async () => ({ kind: "file", mtime: 1, size: 1 }),
    uriOf: (file: string) => pathToFileURL(file).href,
    toPath: (uri: string) => new URL(uri).pathname,
  } as unknown as HostFiles;
  const warned: string[] = [];
  const stop = watchVault(files, "file:///v", throwing, (message) =>
    warned.push(message),
  );
  const unhandled = await unhandledDuring(async () => {
    report("Note.md");
  });
  stop();
  assert.deepEqual(unhandled, []);
  assert.match(warned.join("\n"), /a listener failed/);
});
