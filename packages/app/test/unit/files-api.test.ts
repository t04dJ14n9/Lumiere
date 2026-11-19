// F36: the file tree's changes on the server: paths stay in an open vault,
// deleting goes to the trash first and asks before deleting for good, and
// the trash is reached with the right argv on each system.
import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import type { VaultFileOperations } from "@workshop/host-node";
import { answerFileRoute } from "../../src/server/files-api";
import { createTrash, trashCommand } from "../../src/server/trash";

const VAULT = "/notes";
const uri = (path: string) => pathToFileURL(path).toString();

function operations(calls: string[]): VaultFileOperations {
  return {
    createNote: async (target) => void calls.push(`note ${target}`),
    createFolder: async (target) => void calls.push(`folder ${target}`),
    rename: async (from, to) => {
      calls.push(`rename ${from} ${to}`);
      return [uri("/notes/Linking.md")];
    },
    remove: async (target) => void calls.push(`remove ${target}`),
    contain: async (target) => {
      calls.push(`contain ${target}`);
      return new URL(target).pathname;
    },
    forget: (target) => void calls.push(`forget ${target}`),
    onDidRename: () => () => {},
  };
}

function state(calls: string[], hasTrash: boolean) {
  return {
    openVaults: () => [VAULT],
    files: operations(calls),
    trash: async (file: string) => {
      calls.push(`trash ${file}`);
      return hasTrash;
    },
  };
}

test("new notes, folders and renames are made in the open vault, by vault paths", async () => {
  const calls: string[] = [];
  const answer = (route: string, body: object) =>
    answerFileRoute(route, { vault: VAULT, ...body }, state(calls, true));
  await answer("POST /api/files/note", { path: "a/Untitled.md" });
  await answer("POST /api/files/folder", { path: "a/b" });
  assert.deepEqual(
    await answer("POST /api/files/rename", { from: "a/B.md", to: "c/B.md" }),
    { notUpdated: ["Linking.md"] },
  );
  assert.deepEqual(calls, [
    `note ${uri("/notes/a/Untitled.md")}`,
    `folder ${uri("/notes/a/b")}`,
    `rename ${uri("/notes/a/B.md")} ${uri("/notes/c/B.md")}`,
  ]);
});

test("a path that leaves the vault, or a vault that is not open, is refused", async () => {
  const calls: string[] = [];
  for (const path of [
    "../x.md",
    "a/../../x.md",
    "/etc/x",
    "a//b",
    "a\\b",
    "",
  ]) {
    await assert.rejects(
      answerFileRoute(
        "POST /api/files/note",
        { vault: VAULT, path },
        state(calls, true),
      ),
      path,
    );
  }
  await assert.rejects(
    answerFileRoute(
      "POST /api/files/note",
      { vault: "/elsewhere", path: "x.md" },
      state(calls, true),
    ),
    /Not an open vault/,
  );
  assert.deepEqual(calls, []);
});

test("deleting goes to the trash; without one nothing is deleted until confirmed", async () => {
  const trashed: string[] = [];
  assert.deepEqual(
    await answerFileRoute(
      "POST /api/files/delete",
      { vault: VAULT, path: "old.md" },
      state(trashed, true),
    ),
    { deleted: true, trashed: true },
  );
  assert.deepEqual(trashed, [
    `contain ${uri("/notes/old.md")}`,
    "trash /notes/old.md",
    `forget ${uri("/notes/old.md")}`,
  ]);

  const none: string[] = [];
  assert.deepEqual(
    await answerFileRoute(
      "POST /api/files/delete",
      { vault: VAULT, path: "old.md" },
      state(none, false),
    ),
    { deleted: false, trashed: false },
  );
  assert.equal(
    none.some((call) => call.startsWith("remove")),
    false,
  );
  assert.deepEqual(
    await answerFileRoute(
      "POST /api/files/delete",
      { vault: VAULT, path: "old.md", permanently: true },
      state(none, false),
    ),
    { deleted: true, trashed: false },
  );
  assert.ok(none.includes(`remove ${uri("/notes/old.md")}`));
});

test("the trash's argv on each system; the path is never code", async () => {
  const file = "/notes/a'; rm -rf ~; '.md";
  assert.deepEqual(
    trashCommand("darwin", file, () => true),
    {
      command: "/usr/bin/trash",
      args: [file],
    },
  );
  assert.equal(
    trashCommand("darwin", file, () => false),
    undefined,
  );
  assert.deepEqual(trashCommand("linux", file), {
    command: "gio",
    args: ["trash", "--", file],
  });
  const windows = trashCommand("win32", "C:\\notes\\a.md");
  assert.equal(windows?.command, "powershell.exe");
  assert.deepEqual(windows?.env, { LUMIERE_TRASH: "C:\\notes\\a.md" });
  assert.equal(windows?.args.join(" ").includes("C:\\notes"), false);
  assert.equal(trashCommand("aix", file), undefined);

  // A trash that fails to start (no gio) is no trash: nothing was deleted.
  const failing = createTrash(async () => {
    throw new Error("spawn gio ENOENT");
  }, "linux");
  assert.equal(await failing("/notes/a.md"), false);
});
