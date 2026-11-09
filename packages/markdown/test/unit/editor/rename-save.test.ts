import test from "node:test";
import assert from "node:assert/strict";
import type * as HostDocumentsModule from "../../../src/host/services/documents";
import {
  applyLineColEdits,
  cleanEditedUris,
  expectedOpenEditorText,
  offsetAt,
  partitionLinkUpdateFiles,
} from "../../../src/host/rename-save";

const edit = {
  start: { line: 0, col: 0 },
  end: { line: 0, col: 1 },
  text: "x",
};

test("only notes without unsaved changes are saved after a link update", () => {
  const files = [
    { uri: "file:///a.md", edits: [edit] },
    { uri: "file:///b.md", edits: [edit] },
    { uri: "file:///c.md", edits: [] },
  ];
  assert.deepEqual(
    cleanEditedUris(files, (uri) => uri === "file:///b.md"),
    ["file:///a.md"],
  );
});

test("offsetAt walks LF lines", () => {
  assert.equal(offsetAt("ab\ncd\n", 1, 1), 4);
  assert.equal(offsetAt("ab\ncd", 0, 2), 2);
});

test("applyLineColEdits rewrites all five link forms on an open note", () => {
  const text = [
    "[[Wave5Closed]]",
    "[[Wave5Closed|the target]]",
    "[[Wave5Closed#Wave5 target]]",
    "[go](Wave5Closed.md)",
    "![[Wave5Closed]]",
  ].join("\n");
  const edits = [
    {
      start: { line: 0, col: 0 },
      end: { line: 0, col: 15 },
      text: "[[Wave5Open]]",
    },
    {
      start: { line: 1, col: 0 },
      end: { line: 1, col: 26 },
      text: "[[Wave5Open|the target]]",
    },
    {
      start: { line: 2, col: 0 },
      end: { line: 2, col: 28 },
      text: "[[Wave5Open#Wave5 target]]",
    },
    {
      start: { line: 3, col: 0 },
      end: { line: 3, col: 20 },
      text: "[go](Wave5Open.md)",
    },
    {
      start: { line: 4, col: 0 },
      end: { line: 4, col: 16 },
      text: "![[Wave5Open]]",
    },
  ];
  assert.equal(
    applyLineColEdits(text, edits),
    [
      "[[Wave5Open]]",
      "[[Wave5Open|the target]]",
      "[[Wave5Open#Wave5 target]]",
      "[go](Wave5Open.md)",
      "![[Wave5Open]]",
    ].join("\n"),
  );
});

test("expectedOpenEditorText covers only notes that are open (BH-014)", () => {
  const files = [
    {
      uri: "file:///linker.md",
      edits: [
        {
          start: { line: 0, col: 2 },
          end: { line: 0, col: 5 },
          text: "Open",
        },
      ],
    },
    {
      uri: "file:///closed.md",
      edits: [
        {
          start: { line: 0, col: 0 },
          end: { line: 0, col: 3 },
          text: "new",
        },
      ],
    },
  ];
  const expected = expectedOpenEditorText(files, (uri) =>
    uri === "file:///linker.md" ? "[[Old]]" : undefined,
  );
  assert.deepEqual(
    [...expected.entries()],
    [["file:///linker.md", "[[Open]]"]],
  );
});

test("partitionLinkUpdateFiles keeps closed notes for waitUntil disk save", () => {
  const files = [
    {
      uri: "file:///open.md",
      edits: [
        {
          start: { line: 0, col: 2 },
          end: { line: 0, col: 5 },
          text: "Open",
        },
      ],
    },
    {
      uri: "file:///closed.md",
      edits: [
        {
          start: { line: 0, col: 0 },
          end: { line: 0, col: 3 },
          text: "new",
        },
      ],
    },
    { uri: "file:///empty.md", edits: [] },
  ];
  const { open, closed } = partitionLinkUpdateFiles(
    files,
    new Set(["file:///open.md"]),
    (uri) => (uri === "file:///open.md" ? "[[Old]]" : "[[Old]]"),
  );
  assert.deepEqual([...open.entries()], [["file:///open.md", "[[Open]]"]]);
  assert.deepEqual(
    closed.map((file) => file.uri),
    ["file:///closed.md", "file:///empty.md"],
  );
});

test("a textDocument that is not a Lumiere tab stays on the closed disk path", () => {
  const files = [
    {
      uri: "file:///warmed.md",
      edits: [
        {
          start: { line: 0, col: 0 },
          end: { line: 0, col: 3 },
          text: "new",
        },
      ],
    },
  ];
  // Warmed / leftover TextDocument text exists, but no Lumiere tab → closed.
  const { open, closed } = partitionLinkUpdateFiles(
    files,
    new Set(),
    () => "old",
  );
  assert.equal(open.size, 0);
  assert.deepEqual(
    closed.map((file) => file.uri),
    ["file:///warmed.md"],
  );
});

test("disk bytes yield the same planned text as an open buffer (Preview settle)", () => {
  const text = "See [[Old]] and ![[Old]].\n";
  const edits = [
    {
      start: { line: 0, col: 4 },
      end: { line: 0, col: 11 },
      text: "[[New]]",
    },
    {
      start: { line: 0, col: 16 },
      end: { line: 0, col: 24 },
      text: "![[New]]",
    },
  ];
  // Same capture path settle uses for a closed note (fs bytes) vs open buffer.
  assert.equal(applyLineColEdits(text, edits), "See [[New]] and ![[New]].\n");
});

test("post-rename link updates open renamed and folder-moved notes at their new URIs", async () => {
  const Module = await import("node:module");
  const { createRequire } = Module;
  const { MARKDOWN_EDITOR } =
    await import("../../../src/shared/editor-provider");

  class FakeUri {
    static parse(value: string) {
      return new FakeUri(value);
    }
    constructor(private readonly value: string) {}
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
    readonly start: FakePosition;
    readonly end: FakePosition;
    constructor(
      a: FakePosition | number,
      b: FakePosition | number,
      c?: number,
      d?: number,
    ) {
      if (typeof a === "number") {
        this.start = new FakePosition(a, b as number);
        this.end = new FakePosition(c!, d!);
      } else {
        this.start = a;
        this.end = b as FakePosition;
      }
    }
  }
  class FakeWorkspaceEdit {
    readonly replacements: { uri: string; text: string }[] = [];
    replace(uri: FakeUri, _range: FakeRange, text: string) {
      this.replacements.push({ uri: uri.toString(), text });
    }
  }
  class FakeTabInputCustom {
    constructor(
      readonly uri: FakeUri,
      readonly viewType: string,
    ) {}
  }

  interface FakeDoc {
    uri: FakeUri;
    text: string;
    isDirty: boolean;
    saved: number;
    getText(): string;
    positionAt(offset: number): FakePosition;
    save(): Promise<boolean>;
  }
  const makeDoc = (uri: string, text: string): FakeDoc => ({
    uri: FakeUri.parse(uri),
    text,
    isDirty: false,
    saved: 0,
    getText() {
      return this.text;
    },
    positionAt(offset: number) {
      return new FakePosition(0, offset);
    },
    async save() {
      this.isDirty = false;
      this.saved += 1;
      return true;
    },
  });

  const textDocuments: FakeDoc[] = [
    makeDoc("file:///vault/Moved.md", "[[./Sibling]]"),
    makeDoc("file:///vault/Folder/InFolder.md", "[[./Local]]"),
    makeDoc("file:///vault/FolderExtra/SiblingFolder.md", "[[Moved]]"),
    makeDoc("file:///vault/Other.md", "[[Moved]]"),
  ];
  const tabs = textDocuments.map((doc) => ({
    input: new FakeTabInputCustom(doc.uri, MARKDOWN_EDITOR.viewType),
  }));

  let willRenameListener:
    | ((event: {
        files: { oldUri: FakeUri; newUri: FakeUri }[];
        waitUntil(thenable: Promise<unknown>): void;
      }) => void)
    | undefined;
  let didRenameListener:
    | ((event: { files: { oldUri: FakeUri; newUri: FakeUri }[] }) => void)
    | undefined;

  const fakeVscode = {
    Uri: FakeUri,
    Position: FakePosition,
    Range: FakeRange,
    WorkspaceEdit: FakeWorkspaceEdit,
    TabInputCustom: FakeTabInputCustom,
    window: {
      tabGroups: {
        all: [{ tabs }],
      },
    },
    workspace: {
      textDocuments,
      onWillRenameFiles(listener: typeof willRenameListener) {
        willRenameListener = listener;
        return { dispose() {} };
      },
      onDidRenameFiles(listener: NonNullable<typeof didRenameListener>) {
        didRenameListener = listener;
        return { dispose() {} };
      },
      async openTextDocument(uri: FakeUri) {
        const doc = textDocuments.find(
          (candidate) => candidate.uri.toString() === uri.toString(),
        );
        if (!doc) {
          throw new Error(`FileNotFound: ${uri.toString()}`);
        }
        return doc;
      },
      async applyEdit(edit: FakeWorkspaceEdit) {
        for (const replacement of edit.replacements) {
          const doc = textDocuments.find(
            (candidate) => candidate.uri.toString() === replacement.uri,
          );
          if (!doc) {
            return false;
          }
          doc.text = replacement.text;
          doc.isDirty = true;
        }
        return true;
      },
      fs: {
        async readFile(uri: FakeUri) {
          throw new Error(`Unexpected disk read for ${uri.toString()}`);
        },
      },
    },
  };

  const loader = Module.default as typeof Module.default & {
    _load(id: string, ...args: unknown[]): unknown;
  };
  const originalLoad = loader._load;
  loader._load = (id, ...args) =>
    id === "vscode"
      ? fakeVscode
      : originalLoad.call(Module.default, id, ...args);
  const require = createRequire(import.meta.url);
  let createHostDocuments: typeof HostDocumentsModule.createHostDocuments;
  try {
    ({
      createHostDocuments,
    } = require("../../../src/host/services/documents.ts"));
  } finally {
    loader._load = originalLoad;
  }

  const hostDocuments = createHostDocuments({
    wrap: (doc: unknown) => doc as never,
    native: (doc: unknown) => doc as never,
  } as never);
  hostDocuments.onWillRename(async () => [
    {
      uri: "file:///vault/Moved.md",
      edits: [
        {
          start: { line: 0, col: 0 },
          end: { line: 0, col: 13 },
          text: "[[../Sibling]]",
        },
      ],
    },
    {
      uri: "file:///vault/Folder/InFolder.md",
      edits: [
        {
          start: { line: 0, col: 0 },
          end: { line: 0, col: 11 },
          text: "[[../Local]]",
        },
      ],
    },
    {
      uri: "file:///vault/FolderExtra/SiblingFolder.md",
      edits: [
        {
          start: { line: 0, col: 0 },
          end: { line: 0, col: 9 },
          text: "[[Sub/Moved]]",
        },
      ],
    },
    {
      uri: "file:///vault/Other.md",
      edits: [
        {
          start: { line: 0, col: 0 },
          end: { line: 0, col: 9 },
          text: "[[Sub/Moved]]",
        },
      ],
    },
  ]);

  // The did-rename event names the same files, so it runs this plan.
  const renamed = [
    {
      oldUri: FakeUri.parse("file:///vault/Moved.md"),
      newUri: FakeUri.parse("file:///vault/Sub/Moved.md"),
    },
    {
      oldUri: FakeUri.parse("file:///vault/Folder"),
      newUri: FakeUri.parse("file:///vault/RenamedFolder"),
    },
  ];
  let waitPromise: Promise<unknown> | undefined;
  willRenameListener!({
    files: renamed,
    waitUntil(thenable) {
      waitPromise = thenable;
    },
  });
  await waitPromise;

  // VS Code performs the rename before firing onDidRenameFiles.
  textDocuments[0]!.uri = FakeUri.parse("file:///vault/Sub/Moved.md");
  textDocuments[1]!.uri = FakeUri.parse(
    "file:///vault/RenamedFolder/InFolder.md",
  );
  didRenameListener!({ files: renamed });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(textDocuments[0]!.text, "[[../Sibling]]");
  assert.equal(textDocuments[0]!.saved, 1);
  assert.equal(textDocuments[1]!.text, "[[../Local]]");
  assert.equal(textDocuments[1]!.saved, 1);
  assert.equal(textDocuments[2]!.text, "[[Sub/Moved]]");
  assert.equal(textDocuments[2]!.saved, 1);
  assert.equal(textDocuments[3]!.text, "[[Sub/Moved]]");
  assert.equal(textDocuments[3]!.saved, 1);
});
