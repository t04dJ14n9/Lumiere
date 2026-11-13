import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "@workshop/core";
import { provideHostServices } from "../../../src/shared/host";
import type {
  HostDocument,
  NoteSettings,
  SourceEdit,
} from "../../../src/shared/host";
import { documentHost } from "../../../src/plugins/document/host";
import type { Documents } from "../../../src/plugins/document/api";
import { fakeDocument, fakeHost } from "../../support/vscode-fake";

const AUTOSAVE_MS = 2000;
const EDIT: readonly SourceEdit[] = [{ from: 0, to: 0, insert: "x" }];

/** Lets the save that a fired timer started run to its end. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

type Preferences = Pick<
  NonNullable<NoteSettings["editor"]>,
  "autosave" | "filesAutoSave"
>;

/**
 * A note open in one Lumia panel, whose host the test drives: `edit` types
 * into it as VS Code reports it, `prefs` are the settings the document
 * plugin reads, and `save` decides how a save ends (it defaults to success).
 */
async function openNote(
  t: TestContext,
  options: {
    prefs?: Preferences;
    isUntitled?: boolean;
    save?: (snapshot: string) => Promise<boolean>;
  } = {},
) {
  const prefs: Preferences = {
    autosave: true,
    filesAutoSave: "off",
    ...options.prefs,
  };
  let reportChange!: (
    document: HostDocument,
    changes?: readonly SourceEdit[],
  ) => void;
  const host = fakeHost({
    hostDocuments: {
      onChange(listener) {
        reportChange = listener;
        return () => {};
      },
    },
    settings: {
      forNote: () => ({
        preset: "minimal",
        mode: "source",
        editor: { useTabs: true, tabSize: 4, ...prefs },
      }),
    },
  });
  let text = "note";
  let onDisk = "note";
  const saves: string[] = [];
  // fakeDocument spreads its overrides, which would freeze a getter's value.
  const document: HostDocument = {
    ...fakeDocument({
      isUntitled: options.isUntitled ?? false,
      getText: () => text,
      async save() {
        const snapshot = text;
        saves.push(snapshot);
        const saved = await (options.save?.(snapshot) ?? true);
        if (saved) {
          onDisk = snapshot;
        }
        return saved;
      },
    }),
    get isDirty() {
      return text !== onDisk;
    },
  };
  const root = createRoot();
  provideHostServices(root, host);
  root.plugin(documentHost);
  await root.settled();
  const documents = root.service("documents") as Documents;
  documents.session(document);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  return {
    prefs,
    saves,
    document,
    documents,
    root,
    /** Typing one character; `changes` is what VS Code reports for it. */
    edit(changes: readonly SourceEdit[] | undefined = EDIT) {
      text += "x";
      reportChange(document, changes);
    },
    /** A change event with no new text, such as the dirty flag flipping. */
    flagChange() {
      reportChange(document, []);
    },
    /** Time passes and whatever it starts finishes. */
    async wait(ms: number) {
      t.mock.timers.tick(ms);
      await settle();
    },
  };
}

test("an edited note is saved 2 s after the last edit, not before", async (t) => {
  const note = await openNote(t);
  note.edit();
  await note.wait(AUTOSAVE_MS - 1);
  assert.deepEqual(note.saves, []);
  await note.wait(1);
  assert.deepEqual(note.saves, ["notex"]);
  await note.root.dispose();
});

test("each edit restarts the 2 s, so typing saves once after the pause", async (t) => {
  const note = await openNote(t);
  note.edit();
  await note.wait(1500);
  note.edit();
  await note.wait(1500);
  note.edit();
  await note.wait(AUTOSAVE_MS - 1);
  assert.deepEqual(note.saves, []);
  await note.wait(1);
  assert.deepEqual(note.saves, ["notexxx"]);
  await note.wait(60_000);
  assert.equal(note.saves.length, 1);
  await note.root.dispose();
});

test("a change event with no new text does not restart the countdown", async (t) => {
  const note = await openNote(t);
  note.edit();
  await note.wait(1500);
  note.flagChange();
  await note.wait(500);
  assert.deepEqual(note.saves, ["notex"]);
  await note.root.dispose();
});

test("nothing is saved while the setting is off, even if it was on when the edit landed", async (t) => {
  const note = await openNote(t, { prefs: { autosave: false } });
  note.edit();
  await note.wait(10_000);
  assert.deepEqual(note.saves, []);
  note.prefs.autosave = true;
  note.edit();
  await note.wait(1000);
  note.prefs.autosave = false;
  await note.wait(1000);
  assert.deepEqual(note.saves, []);
  await note.root.dispose();
});

for (const mode of ["afterDelay", "onFocusChange", "onWindowChange"] as const) {
  test(`files.autoSave "${mode}" is left to VS Code`, async (t) => {
    const note = await openNote(t, { prefs: { filesAutoSave: mode } });
    note.edit();
    await note.wait(10_000);
    assert.deepEqual(note.saves, []);
    await note.root.dispose();
  });
}

test("an untitled note is never saved, as that would ask where to put it", async (t) => {
  const note = await openNote(t, { isUntitled: true });
  note.edit();
  await note.wait(10_000);
  assert.deepEqual(note.saves, []);
  await note.root.dispose();
});

test("a note that is no longer dirty when the time comes is not saved again", async (t) => {
  const note = await openNote(t);
  note.edit();
  await note.wait(1000);
  await note.document.save();
  assert.equal(note.saves.length, 1);
  await note.wait(AUTOSAVE_MS);
  assert.equal(note.saves.length, 1);
  await note.root.dispose();
});

test("closing the last panel cancels the countdown; another open panel keeps it", async (t) => {
  const note = await openNote(t);
  note.documents.session(note.document);
  note.edit();
  note.documents.release(note.document);
  await note.wait(AUTOSAVE_MS);
  assert.deepEqual(note.saves, ["notex"]);
  note.edit();
  note.documents.release(note.document);
  await note.wait(10_000);
  assert.deepEqual(note.saves, ["notex"]);
  await note.root.dispose();
});

test("stopping the plugin cancels the countdown", async (t) => {
  const note = await openNote(t);
  note.edit();
  await note.root.dispose();
  await note.wait(10_000);
  assert.deepEqual(note.saves, []);
});

test("a failed save is not retried until the note is edited again", async (t) => {
  const note = await openNote(t, { save: async () => false });
  note.edit();
  await note.wait(AUTOSAVE_MS);
  // saveDocument waits up to 2 s for a late save event before giving up.
  await note.wait(AUTOSAVE_MS);
  await note.wait(60_000);
  assert.equal(note.saves.length, 1);
  note.edit();
  await note.wait(AUTOSAVE_MS);
  assert.equal(note.saves.length, 2);
  await note.wait(AUTOSAVE_MS);
  await note.wait(60_000);
  assert.equal(note.saves.length, 2);
  await note.root.dispose();
});

test("a save that throws is not retried either, and rejects nothing", async (t) => {
  const note = await openNote(t, {
    save: async () => {
      throw new Error("EACCES");
    },
  });
  note.edit();
  await note.wait(AUTOSAVE_MS);
  await note.wait(60_000);
  assert.equal(note.saves.length, 1);
  note.edit();
  await note.wait(AUTOSAVE_MS);
  assert.equal(note.saves.length, 2);
  await note.root.dispose();
});

test("a countdown that ends during a save waits for it, then saves what came after", async (t) => {
  let finish!: () => void;
  const note = await openNote(t, {
    save: () =>
      new Promise<boolean>((resolve) => {
        finish = () => resolve(true);
      }),
  });
  note.edit();
  await note.wait(AUTOSAVE_MS);
  assert.deepEqual(note.saves, ["notex"]);
  note.edit();
  await note.wait(AUTOSAVE_MS);
  // The first save has not ended: no second one overlaps it.
  assert.deepEqual(note.saves, ["notex"]);
  finish();
  await settle();
  await note.wait(AUTOSAVE_MS - 1);
  assert.deepEqual(note.saves, ["notex"]);
  await note.wait(1);
  assert.deepEqual(note.saves, ["notex", "notexx"]);
  finish();
  await settle();
  await note.root.dispose();
});

test("a note edited during a save that then fails is not saved by the failed save's catch-up", async (t) => {
  let finish!: (saved: boolean) => void;
  const note = await openNote(t, {
    save: () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
  });
  note.edit();
  await note.wait(AUTOSAVE_MS);
  note.edit();
  await note.wait(AUTOSAVE_MS);
  finish(false);
  await settle();
  await note.wait(AUTOSAVE_MS);
  await note.wait(60_000);
  assert.deepEqual(note.saves, ["notex"]);
  await note.root.dispose();
});
