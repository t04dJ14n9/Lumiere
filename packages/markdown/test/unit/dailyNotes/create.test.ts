import assert from "node:assert/strict";
import test from "node:test";
import {
  createDailyNote,
  type DailyNoteFiles,
} from "../../../src/plugins/dailyNotes/create";

const ROOT = "file:///vault";

function filesWith(options: {
  existing?: Record<string, string>;
  indexed?: string[];
  symlinks?: string[];
}) {
  const data = new Map(Object.entries(options.existing ?? {}));
  const made: string[] = [];
  const messages: string[] = [];
  const io: DailyNoteFiles = {
    root: ROOT,
    files: {
      list: async (uri) => {
        const prefix = `${uri}/`;
        const names = [...data.keys()]
          .filter((key) => key.startsWith(prefix))
          .map((key) => key.slice(prefix.length));
        return names.length ? names : undefined;
      },
      mkdir: async (uri) => {
        made.push(uri);
      },
      readText: async (uri) => data.get(uri),
      writeText: async (uri, text) => {
        data.set(uri, text);
      },
      isSymbolicLink: async (uri) => options.symlinks?.includes(uri) ?? false,
    },
    isIndexed: (path) => options.indexed?.includes(path) ?? false,
    inform: (message) => messages.push(`inform: ${message}`),
    error: (message) => messages.push(`error: ${message}`),
  };
  return { io, data, made, messages };
}

const expand = (text: string, title: string) =>
  text.replaceAll("{{title}}", title);

test("creates a missing note from the template, making its folders", async () => {
  const { io, data, made } = filesWith({
    existing: { [`${ROOT}/Templates/Daily.md`]: "# {{title}}\n" },
  });
  const uri = await createDailyNote(io, {
    path: "Journal/2026/2026-11-05.md",
    template: "Templates/Daily",
    expand,
  });
  assert.equal(uri, `${ROOT}/Journal/2026/2026-11-05.md`);
  assert.deepEqual(made, [`${ROOT}/Journal/2026`]);
  assert.equal(data.get(uri!), "# 2026-11-05\n");
});

test("an existing note is opened as it is, whether indexed or only on disk", async () => {
  const onDisk = filesWith({
    existing: { [`${ROOT}/Journal/2026-11-05.md`]: "kept" },
  });
  const indexed = filesWith({ indexed: ["Journal/2026-11-05.md"] });
  for (const { io, data, made } of [onDisk, indexed]) {
    const uri = await createDailyNote(io, {
      path: "Journal/2026-11-05.md",
      template: "",
      expand,
    });
    assert.equal(uri, `${ROOT}/Journal/2026-11-05.md`);
    assert.deepEqual(made, []);
    assert.notEqual(data.get(uri!), "");
  }
});

test("a missing template creates an empty note and says so", async () => {
  const { io, data, messages } = filesWith({});
  const uri = await createDailyNote(io, {
    path: "2026-11-05.md",
    template: "Templates/Gone",
    expand,
  });
  assert.equal(data.get(uri!), "");
  assert.deepEqual(messages, [
    "inform: Daily note template Templates/Gone was not found; the note was created empty.",
  ]);
});

test("a path through a symbolic link is refused before writing", async () => {
  const { io, data, messages } = filesWith({
    symlinks: [`${ROOT}/Journal`],
  });
  const uri = await createDailyNote(io, {
    path: "Journal/2026-11-05.md",
    template: "",
    expand,
  });
  assert.equal(uri, undefined);
  assert.equal(data.size, 0);
  assert.match(messages[0]!, /symbolic link/);
});
