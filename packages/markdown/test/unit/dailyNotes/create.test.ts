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
  /** Symbolic links by URI to the URI they point at, followed by reads. */
  links?: Record<string, string>;
  /** A host without a containment check. */
  unauthorized?: boolean;
  /** Template reads wait until the test releases them. */
  gate?: Promise<void>;
}) {
  const data = new Map(Object.entries(options.existing ?? {}));
  const links = Object.entries(options.links ?? {});
  const reads: string[] = [];
  // The real path: the longest linked prefix replaced by its target.
  const real = (uri: string): string => {
    const link = links
      .filter(([from]) => uri === from || uri.startsWith(`${from}/`))
      .sort(([a], [b]) => b.length - a.length)[0];
    return link ? real(link[1] + uri.slice(link[0].length)) : uri;
  };
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
      readText: async (uri) => {
        reads.push(uri);
        await options.gate;
        return data.get(real(uri));
      },
      createText: async (uri, text) => {
        if (data.has(uri)) {
          return false;
        }
        data.set(uri, text);
        return true;
      },
      isSymbolicLink: async (uri) => options.symlinks?.includes(uri) ?? false,
      ...(options.unauthorized
        ? {}
        : {
            authorize: async (root: string, target: string) => {
              if (!real(target).startsWith(`${root}/`)) {
                throw new Error("Link symlink escapes the vault");
              }
            },
          }),
    },
    isIndexed: (path) => options.indexed?.includes(path) ?? false,
    inform: (message) => messages.push(`inform: ${message}`),
    error: (message) => messages.push(`error: ${message}`),
  };
  return { io, data, made, messages, reads };
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

test("a template that is a symbolic link out of the vault is not read", async () => {
  const { io, data, messages, reads } = filesWith({
    existing: { "file:///outside/secret.md": "SECRET {{title}}" },
    links: { [`${ROOT}/Templates/Daily.md`]: "file:///outside/secret.md" },
  });
  const uri = await createDailyNote(io, {
    path: "2026-11-05.md",
    template: "Templates/Daily",
    expand,
  });
  assert.equal(data.get(uri!), "");
  assert.deepEqual(reads, []);
  assert.match(messages[0]!, /^error: .*Templates\/Daily.*outside the vault/);
});

test("a template under a symbolic link to a folder outside the vault is not read", async () => {
  const { io, data, messages, reads } = filesWith({
    existing: { "file:///outside/Templates/Daily.md": "SECRET {{title}}" },
    links: { [`${ROOT}/Templates`]: "file:///outside/Templates" },
  });
  const uri = await createDailyNote(io, {
    path: "2026-11-05.md",
    template: "Templates/Daily.md",
    expand,
  });
  assert.equal(data.get(uri!), "");
  assert.deepEqual(reads, []);
  assert.match(messages[0]!, /outside the vault/);
});

test("a symbolic link that stays inside the vault is a usable template", async () => {
  const { io, data, messages } = filesWith({
    existing: { [`${ROOT}/Shared/Daily.md`]: "# {{title}}\n" },
    links: { [`${ROOT}/Templates`]: `${ROOT}/Shared` },
  });
  const uri = await createDailyNote(io, {
    path: "2026-11-05.md",
    template: "Templates/Daily",
    expand,
  });
  assert.equal(data.get(uri!), "# 2026-11-05\n");
  assert.deepEqual(messages, []);
});

test("a host with no containment check reads no template", async () => {
  const { io, data, messages, reads } = filesWith({
    existing: { [`${ROOT}/Templates/Daily.md`]: "# {{title}}\n" },
    unauthorized: true,
  });
  const uri = await createDailyNote(io, {
    path: "2026-11-05.md",
    template: "Templates/Daily",
    expand,
  });
  assert.equal(data.get(uri!), "");
  assert.deepEqual(reads, []);
  assert.match(messages[0]!, /outside the vault/);
});

test("a note that appears while the template is read is opened, not overwritten", async () => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { io, data, messages, reads } = filesWith({
    existing: { [`${ROOT}/Templates/Daily.md`]: "# {{title}}\n" },
    gate,
  });
  const pending = createDailyNote(io, {
    path: "2026-11-05.md",
    template: "Templates/Daily",
    expand,
  });
  while (reads.length === 0) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  // Another window, or a sync, creates today's note while the template is read.
  const uri = `${ROOT}/2026-11-05.md`;
  data.set(uri, "written elsewhere");
  release();
  assert.equal(await pending, uri);
  assert.equal(data.get(uri), "written elsewhere");
  assert.deepEqual(messages, []);
});
