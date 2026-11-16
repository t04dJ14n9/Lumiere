import test from "node:test";
import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import type * as HostDocumentsModule from "../../../src/host/services/documents";
import type { FileTextEdits, HostDocuments } from "../../../src/shared/host";

class FakeUri {
  static parse(value: string) {
    return new FakeUri(value);
  }
  constructor(private readonly value: string) {}
  get path() {
    return this.value.replace("file://", "");
  }
  toString() {
    return this.value;
  }
}
class FakePosition {
  constructor(
    readonly line: number,
    readonly character: number,
  ) {}
}
class FakeRange {
  constructor(
    readonly start: FakePosition | number,
    readonly end: FakePosition | number,
    readonly endLine?: number,
    readonly endCharacter?: number,
  ) {}
}
class FakeWorkspaceEdit {
  readonly replacements: { uri: string; text: string }[] = [];
  replace(uri: FakeUri, _range: FakeRange, text: string) {
    this.replacements.push({ uri: uri.toString(), text });
  }
}
class FakeTabInputCustom {}

interface FakeDoc {
  uri: FakeUri;
  text: string;
  /** The line ending VS Code keeps the document in. */
  eol: string;
  isDirty: boolean;
  saved: number;
  /** Writes the saved text back to the file the document was opened from. */
  written?: (text: string) => void;
  getText(): string;
  positionAt(offset: number): FakePosition;
  save(): Promise<boolean>;
}

function makeDoc(uri: string, text: string): FakeDoc {
  return {
    uri: FakeUri.parse(uri),
    text,
    eol: text.includes("\r\n") ? "\r\n" : "\n",
    isDirty: false,
    saved: 0,
    getText() {
      return this.text;
    },
    positionAt(offset) {
      return new FakePosition(0, offset);
    },
    async save() {
      this.isDirty = false;
      this.saved += 1;
      this.written?.(this.text);
      return true;
    },
  };
}

type FileRename = { oldUri: FakeUri; newUri: FakeUri };
type WillRenameEvent = {
  files: FileRename[];
  waitUntil(thenable: Promise<unknown>): void;
};

/**
 * `documents.ts` against a fake VS Code workspace with open notes and, in
 * `onDisk`, files no document is open on: VS Code reads those without their
 * BOM and in one line-ending style when it opens them.
 */
function setup(
  notes: Record<string, string>,
  onDisk: Record<string, string> = {},
) {
  const docs = Object.entries(notes).map(([uri, text]) => makeDoc(uri, text));
  const disk = new Map(Object.entries(onDisk));
  const openFromDisk = (uri: string): FakeDoc | undefined => {
    const raw = disk.get(uri);
    if (raw === undefined) {
      return undefined;
    }
    const hasBom = raw.startsWith("\uFEFF");
    const body = hasBom ? raw.slice(1) : raw;
    const eol = body.includes("\r\n") ? "\r\n" : "\n";
    const doc = makeDoc(uri, body.replace(/\r\n|\r|\n/g, eol));
    doc.written = (text) => disk.set(uri, (hasBom ? "\uFEFF" : "") + text);
    docs.push(doc);
    return doc;
  };
  const didListeners = new Set<(event: { files: FileRename[] }) => void>();
  let willListener: ((event: WillRenameEvent) => void) | undefined;
  const applied: string[] = [];
  const failures: ((uri: string) => boolean)[] = [];
  const warnings: string[] = [];

  const fakeVscode = {
    Uri: FakeUri,
    Position: FakePosition,
    Range: FakeRange,
    WorkspaceEdit: FakeWorkspaceEdit,
    TabInputCustom: FakeTabInputCustom,
    window: {
      tabGroups: { all: [] },
      showWarningMessage(message: string) {
        warnings.push(message);
      },
    },
    workspace: {
      textDocuments: docs,
      onWillRenameFiles(listener: typeof willListener) {
        willListener = listener;
        return { dispose() {} };
      },
      onDidRenameFiles(listener: (event: { files: FileRename[] }) => void) {
        didListeners.add(listener);
        return { dispose: () => didListeners.delete(listener) };
      },
      async openTextDocument(uri: FakeUri) {
        const doc =
          docs.find((d) => d.uri.toString() === uri.toString()) ??
          openFromDisk(uri.toString());
        if (!doc) {
          throw new Error(`FileNotFound: ${uri.toString()}`);
        }
        return doc;
      },
      async applyEdit(edit: FakeWorkspaceEdit) {
        const replacement = edit.replacements[0]!;
        applied.push(replacement.uri);
        if (failures.some((fails) => fails(replacement.uri))) {
          return false;
        }
        const doc = docs.find((d) => d.uri.toString() === replacement.uri)!;
        doc.text = replacement.text.replace(/\r\n|\r|\n/g, doc.eol);
        doc.isDirty = true;
        return true;
      },
      fs: {
        async readFile(uri: FakeUri) {
          const raw = disk.get(uri.toString());
          if (raw === undefined) {
            throw new Error(`Unexpected disk read for ${uri.toString()}`);
          }
          return Buffer.from(raw);
        },
      },
    },
  };

  const loader = Module as typeof Module & {
    _load(id: string, ...args: unknown[]): unknown;
  };
  const originalLoad = loader._load;
  loader._load = (id, ...args) =>
    id === "vscode" ? fakeVscode : originalLoad.call(Module, id, ...args);
  const require = createRequire(import.meta.url);
  // Each test brings its own fake: load the host module again for it.
  for (const id of Object.keys(require.cache)) {
    if (id.includes("/src/host/") || id.includes("/src/shared/")) {
      delete require.cache[id];
    }
  }
  let createHostDocuments: typeof HostDocumentsModule.createHostDocuments;
  try {
    ({
      createHostDocuments,
    } = require("../../../src/host/services/documents.ts"));
  } finally {
    loader._load = originalLoad;
  }
  const hostDocuments: HostDocuments = createHostDocuments({
    wrap: (doc: unknown) => doc as never,
    native: (doc: unknown) => doc as never,
  } as never);

  return {
    docs,
    applied,
    failures,
    warnings,
    didListeners,
    doc: (uri: string) => docs.find((d) => d.uri.toString() === uri)!,
    /** What a file holds on disk. */
    disk: (uri: string) => disk.get(uri),
    onWillRename: hostDocuments.onWillRename,
    /** VS Code asks participants for edits and waits for them. */
    async willRename(pairs: [string, string][]) {
      const files = pairs.map(([from, to]) => ({
        oldUri: FakeUri.parse(from),
        newUri: FakeUri.parse(to),
      }));
      let waited: Promise<unknown> | undefined;
      willListener!({ files, waitUntil: (thenable) => (waited = thenable) });
      await waited;
    },
    /** VS Code announces a finished rename to every live listener. */
    async didRename(pairs: [string, string][]) {
      const files = pairs.map(([from, to]) => ({
        oldUri: FakeUri.parse(from),
        newUri: FakeUri.parse(to),
      }));
      for (const listener of [...didListeners]) {
        listener({ files });
      }
      await settleMicrotasks();
    },
  };
}

async function settleMicrotasks(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

const LINKER = "file:///vault/Linker.md";
const OLD = "file:///vault/Old.md";
const NEW = "file:///vault/New.md";

/** Rewrites the `[[Old]]` link on whichever line it sits now. */
function relinkOld(text: string, to: string): FileTextEdits["edits"] {
  const lines = text.split("\n");
  const line = lines.findIndex((candidate) => candidate.includes("[[Old]]"));
  const col = lines[line]!.indexOf("[[Old]]");
  return [
    {
      start: { line, col },
      end: { line, col: col + "[[Old]]".length },
      text: `[[${to}]]`,
    },
  ];
}

test("a rename cancelled in Refactor Preview does not rewrite notes on the next rename", async () => {
  const world = setup({ [LINKER]: "See [[Old]].\n" });
  world.onWillRename(async (renames) =>
    renames.some((rename) => rename.oldUri === OLD)
      ? [
          {
            uri: LINKER,
            edits: relinkOld(world.doc(LINKER).text, "Aborted"),
          },
        ]
      : [],
  );

  // The user cancels the preview: no did-rename event ever follows.
  await world.willRename([[OLD, "file:///vault/Aborted.md"]]);
  world.doc(LINKER).text = "My own edits.\n";

  await world.willRename([["file:///vault/pic.png", "file:///vault/img.png"]]);
  await world.didRename([["file:///vault/pic.png", "file:///vault/img.png"]]);

  assert.equal(world.doc(LINKER).text, "My own edits.\n");
  assert.deepEqual(world.applied, []);
});

test("turning link updates off drops a plan for a rename that never finished", async () => {
  const world = setup({ [LINKER]: "See [[Old]].\n" });
  const stop = world.onWillRename(async () => [
    { uri: LINKER, edits: relinkOld(world.doc(LINKER).text, "New") },
  ]);

  // The user cancels the preview, then turns the feature off.
  await world.willRename([[OLD, NEW]]);
  stop();
  world.doc(LINKER).text = "My own edits.\n";
  await world.didRename([[OLD, NEW]]);

  assert.equal(world.doc(LINKER).text, "My own edits.\n");
  assert.deepEqual(world.applied, []);
  assert.equal(world.didListeners.size, 0);
});

test("planning the same rename again replaces the earlier plan", async () => {
  const world = setup({ [LINKER]: "See [[Old]].\n" });
  world.onWillRename(async () => [
    { uri: LINKER, edits: relinkOld(world.doc(LINKER).text, "New") },
  ]);

  await world.willRename([[OLD, NEW]]);
  // Cancelled, then the note changed before the user tried again.
  world.doc(LINKER).text = "Intro\nSee [[Old]].\n";
  await world.willRename([[OLD, NEW]]);
  await world.didRename([[OLD, NEW]]);

  assert.equal(world.doc(LINKER).text, "Intro\nSee [[New]].\n");
  assert.deepEqual(world.applied, [LINKER]);
});

test("the finished rename still applies and saves its link updates", async () => {
  const world = setup({ [LINKER]: "See [[Old]].\n" });
  const second: [string, string] = [
    "file:///vault/a.png",
    "file:///vault/b.png",
  ];
  world.onWillRename(async () => [
    { uri: LINKER, edits: relinkOld(world.doc(LINKER).text, "New") },
  ]);

  await world.willRename([[OLD, NEW], second]);
  // VS Code may list a multi-file rename in another order.
  await world.didRename([second, [OLD, NEW]]);

  assert.equal(world.doc(LINKER).text, "See [[New]].\n");
  assert.equal(world.doc(LINKER).saved, 1);
  assert.equal(world.didListeners.size, 0);
});

test("a retry does not overwrite what the user typed into a note already updated", async () => {
  const first = "file:///vault/First.md";
  const second = "file:///vault/Second.md";
  const world = setup({ [first]: "[[Old]]\n", [second]: "[[Old]]\n" });
  world.onWillRename(async () =>
    [first, second].map((uri) => ({
      uri,
      edits: relinkOld(world.doc(uri).text, "New"),
    })),
  );
  // The second note's edit fails once, so the settle loop waits and retries.
  let failed = false;
  world.failures.push((uri) => {
    if (uri !== second || failed) {
      return false;
    }
    failed = true;
    world.doc(first).text = "typed meanwhile\n";
    return true;
  });

  await world.willRename([[OLD, NEW]]);
  await world.didRename([[OLD, NEW]]);
  await new Promise((resolve) => setTimeout(resolve, 400));

  assert.equal(world.doc(first).text, "typed meanwhile\n");
  assert.equal(world.doc(second).text, "[[New]]\n");
});

test("a note typed into after the plan is made keeps its text, and the user is told", async () => {
  const world = setup({ [LINKER]: "See [[Old]].\n" });
  world.onWillRename(async () => [
    { uri: LINKER, edits: relinkOld(world.doc(LINKER).text, "New") },
  ]);

  await world.willRename([[OLD, NEW]]);
  world.doc(LINKER).text = "Typed meanwhile.\nSee [[Old]].\n";
  world.doc(LINKER).isDirty = true;
  await world.didRename([[OLD, NEW]]);

  assert.equal(world.doc(LINKER).text, "Typed meanwhile.\nSee [[Old]].\n");
  assert.equal(world.doc(LINKER).saved, 0);
  assert.deepEqual(world.applied, []);
  assert.deepEqual(world.warnings, [
    "Links in Linker.md were not updated. Check them after the rename.",
  ]);
});

test("a retry after a failed apply does not overwrite what the user typed meanwhile", async () => {
  const world = setup({ [LINKER]: "See [[Old]].\n" });
  world.onWillRename(async () => [
    { uri: LINKER, edits: relinkOld(world.doc(LINKER).text, "New") },
  ]);
  // The first apply fails, and the user types before the settle loop tries again.
  let failed = false;
  world.failures.push(() => {
    if (failed) {
      return false;
    }
    failed = true;
    world.doc(LINKER).text = "Typed meanwhile.\nSee [[Old]].\n";
    return true;
  });

  await world.willRename([[OLD, NEW]]);
  await world.didRename([[OLD, NEW]]);
  await new Promise((resolve) => setTimeout(resolve, 400));

  assert.equal(world.doc(LINKER).text, "Typed meanwhile.\nSee [[Old]].\n");
  assert.equal(world.doc(LINKER).saved, 0);
  assert.equal(world.warnings.length, 1);
});

/** Runs the settle loop out: 300 attempts, 100 ms apart. */
async function runOutRetries(tick: (ms: number) => void): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt++) {
    tick(100);
    await new Promise((resolve) => setImmediate(resolve));
  }
}

test("a note that cannot be opened does not stop the notes after it, and the user is told", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const first = "file:///vault/First.md";
  const second = "file:///vault/Second.md";
  const world = setup({ [first]: "[[Old]]\n", [second]: "[[Old]]\n" });
  world.onWillRename(async () =>
    [first, second].map((uri) => ({
      uri,
      edits: relinkOld(world.doc(uri).text, "New"),
    })),
  );

  await world.willRename([[OLD, NEW]]);
  // The first note is deleted before the rename finishes.
  world.docs.splice(world.docs.indexOf(world.doc(first)), 1);
  await world.didRename([[OLD, NEW]]);

  assert.equal(world.doc(second).text, "[[New]]\n");
  assert.equal(world.doc(second).saved, 1);
  await runOutRetries((ms) => t.mock.timers.tick(ms));
  assert.deepEqual(world.warnings, [
    "Links in First.md were not updated. Check them after the rename.",
  ]);
});

test("a note that cannot be saved does not stop the notes after it, and the user is told", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const first = "file:///vault/First.md";
  const second = "file:///vault/Second.md";
  const world = setup({ [first]: "[[Old]]\n", [second]: "[[Old]]\n" });
  world.doc(first).save = async () => {
    throw new Error("EACCES: permission denied");
  };
  world.onWillRename(async () =>
    [first, second].map((uri) => ({
      uri,
      edits: relinkOld(world.doc(uri).text, "New"),
    })),
  );

  await world.willRename([[OLD, NEW]]);
  await world.didRename([[OLD, NEW]]);

  assert.equal(world.doc(second).text, "[[New]]\n");
  assert.equal(world.doc(second).saved, 1);
  await runOutRetries((ms) => t.mock.timers.tick(ms));
  assert.deepEqual(world.warnings, [
    "Links in First.md were not updated. Check them after the rename.",
  ]);
});

/** What the plugin plans for one note: its `[[Old]]` link renamed. */
function planRelink(world: ReturnType<typeof setup>, text: string) {
  world.onWillRename(async () => [
    { uri: LINKER, edits: relinkOld(text, "New") },
  ]);
}

test("an untouched CRLF note is updated after a rename", async () => {
  const world = setup({}, { [LINKER]: "Intro\r\nSee [[Old]].\r\n" });
  planRelink(world, "Intro\r\nSee [[Old]].\r\n");

  await world.willRename([[OLD, NEW]]);
  await world.didRename([[OLD, NEW]]);

  assert.equal(world.doc(LINKER).text, "Intro\r\nSee [[New]].\r\n");
  assert.equal(world.disk(LINKER), "Intro\r\nSee [[New]].\r\n");
  assert.deepEqual(world.warnings, []);
});

test("an untouched note with a BOM is updated and keeps its BOM", async () => {
  const world = setup({}, { [LINKER]: "\uFEFFSee [[Old]].\n" });
  planRelink(world, "See [[Old]].\n");

  await world.willRename([[OLD, NEW]]);
  await world.didRename([[OLD, NEW]]);

  assert.equal(world.doc(LINKER).text, "See [[New]].\n");
  assert.equal(world.disk(LINKER), "\uFEFFSee [[New]].\n");
  assert.deepEqual(world.warnings, []);
});

test("an untouched note with mixed line endings is updated", async () => {
  const world = setup({}, { [LINKER]: "A\r\nSee [[Old]].\nB\r\n" });
  planRelink(world, "A\r\nSee [[Old]].\nB\r\n");

  await world.willRename([[OLD, NEW]]);
  await world.didRename([[OLD, NEW]]);

  // VS Code keeps the note in its most used line ending.
  assert.equal(world.doc(LINKER).text, "A\r\nSee [[New]].\r\nB\r\n");
  assert.equal(world.disk(LINKER), "A\r\nSee [[New]].\r\nB\r\n");
  assert.deepEqual(world.warnings, []);
});

test("a CRLF note typed into after the plan is made keeps its text, and the user is told", async () => {
  const world = setup({ [LINKER]: "See [[Old]].\r\n" });
  planRelink(world, "See [[Old]].\r\n");

  await world.willRename([[OLD, NEW]]);
  world.doc(LINKER).text = "Typed meanwhile.\r\nSee [[Old]].\r\n";
  world.doc(LINKER).isDirty = true;
  await world.didRename([[OLD, NEW]]);

  assert.equal(world.doc(LINKER).text, "Typed meanwhile.\r\nSee [[Old]].\r\n");
  assert.equal(world.doc(LINKER).saved, 0);
  assert.deepEqual(world.warnings, [
    "Links in Linker.md were not updated. Check them after the rename.",
  ]);
});
