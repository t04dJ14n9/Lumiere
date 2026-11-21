import assert from "node:assert/strict";
import test from "node:test";
import { EditorState } from "@codemirror/state";
import { metadata } from "../../../src/markdown/metadata";
import { noteFragment } from "../../../src/markdown/metadata/fragments";
import { linkSyntax } from "../../../src/markdown/metadata/linkpaths";
import { resolveNavigationTarget } from "../../../src/plugins/links/target-highlight";
import {
  splitLinktext,
  splitMarkdownDestination,
} from "../../../src/shared/vault-path";
import type { Editors } from "../../../src/plugins/editor/api";
import { renameHeading } from "../../../src/plugins/linkUpdates/rename-heading";
import { SourceCoordinates } from "../../../src/shared/document/coordinates";
import type { HostDocument, TextEdit } from "../../../src/shared/host";
import { fakeDocument, fakeHost } from "../../support/vscode-fake";
import { memoryVaults, uriOf } from "../views/fakes";

/** What `hostDocuments.apply` does: editor (LF) offsets in, source text out. */
function applyEditorEdits(source: string, edits: readonly TextEdit[]): string {
  const coordinates = new SourceCoordinates(source);
  return edits
    .map((edit) => ({
      from: coordinates.toSource(edit.from),
      to: coordinates.toSource(edit.to),
      insert: edit.insert,
    }))
    .sort((a, b) => b.from - a.from)
    .reduce(
      (text, edit) =>
        text.slice(0, edit.from) + edit.insert + text.slice(edit.to),
      source,
    );
}

interface RenameOptions {
  /** Whether `Note.md` accepts its edit. */
  isApplied?: boolean;
  /** Runs as a linking note is opened; it may change the notes or throw. */
  whileOpening?: (docs: Map<string, string>, uri: string) => void;
  /** Linking notes that refuse their edit. */
  refused?: readonly string[];
  /** Notes that have unsaved changes before the rename. */
  unsaved?: readonly string[];
  /** Notes whose save fails. */
  unsaveable?: readonly string[];
}

/** Renames the heading holding `caretAt` in `Note.md`; `input` is the prompt. */
async function rename(
  notes: Record<string, string>,
  caretAt: string,
  input: (docs: Map<string, string>) => string,
  {
    isApplied = true,
    whileOpening,
    refused = [],
    unsaved = [],
    unsaveable = [],
  }: RenameOptions = {},
) {
  const docs = new Map(
    Object.entries(notes).map(([path, text]) => [uriOf(path), text]),
  );
  const informed: string[] = [];
  const errors: string[] = [];
  // What the prompt's validation said of the name typed.
  const validations: (string | undefined)[] = [];
  // The note each `hostDocuments.apply` call edited, one entry per call.
  const applies: string[] = [];
  const dirty = new Set(unsaved);
  const saved: string[] = [];
  const document = (uri: string): HostDocument =>
    Object.defineProperty(
      fakeDocument({
        uri,
        id: uri,
        getText: () => docs.get(uri) ?? "",
        save: async () => {
          if (unsaveable.includes(uri)) {
            return false;
          }
          saved.push(uri);
          dirty.delete(uri);
          return true;
        },
      }),
      "isDirty",
      { get: () => dirty.has(uri) },
    );
  const host = fakeHost({
    dialogs: {
      error: (message) => errors.push(message),
      inform: (message) => informed.push(message),
      input: async ({ validate }) => {
        const value = input(docs);
        validations.push(validate(value));
        return value;
      },
    },
    hostDocuments: {
      text: (uri) => docs.get(uri),
      open: async (uri) => {
        whileOpening?.(docs, uri);
        return document(uri);
      },
      apply: async (target, edits) => {
        applies.push(target.uri);
        // Only the note being renamed can refuse its edit.
        if (!isApplied && target.uri === uriOf("Note.md")) {
          return false;
        }
        if (refused.includes(target.uri)) {
          return false;
        }
        docs.set(target.uri, applyEditorEdits(target.getText(), edits));
        dirty.add(target.uri);
        return true;
      },
    },
  });
  const note = notes["Note.md"]!;
  const caret = new SourceCoordinates(note).toEditor(
    note.indexOf(caretAt) + caretAt.length,
  );
  const panel = {
    document: document(uriOf("Note.md")),
    rpc: {
      call: async () => ({ from: caret, to: caret, version: 1, text: "" }),
    },
  };
  await renameHeading({
    editors: { active: () => panel } as unknown as Editors,
    dialogs: host.dialogs,
    vaults: memoryVaults(notes).vaults,
    hostDocuments: host.hostDocuments,
  });
  return {
    text: (path: string) => docs.get(uriOf(path)),
    informed,
    errors,
    saved,
    validations,
    applies,
  };
}

test("renaming a heading in a CRLF note edits the heading and its links in place", async () => {
  const { text } = await rename(
    { "Note.md": "Intro\r\n\r\n# Old\r\nSee [[#Old]]\r\n" },
    "# Old",
    () => "New",
  );
  assert.equal(text("Note.md"), "Intro\r\n\r\n# New\r\nSee [[#New]]\r\n");
});

test("renaming a heading updates the links in a CRLF note that links to it", async () => {
  const { text } = await rename(
    {
      "Note.md": "Intro\r\n\r\n# Old\r\n",
      "Other.md": "Line\r\nSee [[Note#Old]] here\r\n",
    },
    "# Old",
    () => "New",
  );
  assert.equal(text("Other.md"), "Line\r\nSee [[Note#New]] here\r\n");
  assert.equal(text("Note.md"), "Intro\r\n\r\n# New\r\n");
});

test("a note edited while the name is asked is left alone and the user is told", async () => {
  const note = "# Old\n\nSee [[#Old]].\n";
  const edited = `A line added meanwhile\n${note}`;
  const { text, informed } = await rename(
    { "Note.md": note, "Other.md": "See [[Note#Old]].\n" },
    "# Old",
    (docs) => {
      docs.set(uriOf("Note.md"), edited);
      return "New";
    },
  );
  assert.equal(text("Note.md"), edited);
  assert.equal(text("Other.md"), "See [[Note#Old]].\n");
  assert.deepEqual(informed, [
    "The note changed while the heading was being renamed. Try again.",
  ]);
});

test("when the note itself cannot be edited, the notes linking to it are left alone", async () => {
  const { text } = await rename(
    { "Note.md": "# Old\n", "Other.md": "See [[Note#Old]].\n" },
    "# Old",
    () => "New",
    { isApplied: false },
  );
  assert.equal(text("Other.md"), "See [[Note#Old]].\n");
});

test("a note linking to the heading that changes while it is opened is updated at its new offsets", async () => {
  const { text } = await rename(
    { "Note.md": "# Old\n", "Other.md": "See [[Note#Old]] here\n" },
    "# Old",
    () => "New",
    {
      whileOpening: (docs) =>
        docs.set(uriOf("Other.md"), `Typed ${docs.get(uriOf("Other.md"))}`),
    },
  );
  assert.equal(text("Other.md"), "Typed See [[Note#New]] here\n");
});

test("a linking note that cannot be opened does not stop the notes after it, and the user is told", async () => {
  const { text, errors } = await rename(
    {
      "Note.md": "# Old\n",
      "A.md": "See [[Note#Old]].\n",
      "B.md": "See [[Note#Old]].\n",
    },
    "# Old",
    () => "New",
    {
      whileOpening: (_docs, uri) => {
        if (uri === uriOf("A.md")) {
          throw new Error("FileNotFound");
        }
      },
    },
  );
  assert.equal(text("Note.md"), "# New\n");
  assert.equal(text("A.md"), "See [[Note#Old]].\n");
  assert.equal(text("B.md"), "See [[Note#New]].\n");
  assert.deepEqual(errors, [
    "The heading was renamed, but its links could not be updated in A.md.",
  ]);
});

test("a linking note that refuses its edit is named, and the notes after it are still updated", async () => {
  const { text, errors } = await rename(
    {
      "Note.md": "# Old\n",
      "A.md": "See [[Note#Old]].\n",
      "B.md": "See [[Note#Old]].\n",
    },
    "# Old",
    () => "New",
    { refused: [uriOf("A.md")] },
  );
  assert.equal(text("A.md"), "See [[Note#Old]].\n");
  assert.equal(text("B.md"), "See [[Note#New]].\n");
  assert.deepEqual(errors, [
    "The heading was renamed, but its links could not be updated in A.md.",
  ]);
});

test("linking notes are saved after their links change, unless they had unsaved changes", async () => {
  const { text, saved, errors } = await rename(
    {
      "Note.md": "# Old\n",
      "A.md": "See [[Note#Old]].\n",
      "B.md": "See [[Note#Old]].\n",
      "C.md": "No link here.\n",
    },
    "# Old",
    () => "New",
    { unsaved: [uriOf("B.md")] },
  );
  assert.equal(text("A.md"), "See [[Note#New]].\n");
  assert.equal(text("B.md"), "See [[Note#New]].\n");
  // As a file rename's link updates do: B.md keeps its unsaved changes
  // for the user to review, and the note being renamed is the user's own.
  assert.deepEqual(saved, [uriOf("A.md")]);
  assert.deepEqual(errors, []);
});

test("links to the heading are updated in .markdown and upper-case .MD notes", async () => {
  const { text } = await rename(
    {
      "Note.md": "# Old\n",
      "A.markdown": "See [[Note#Old]].\n",
      "B.MD": "See [[Note#Old]].\n",
    },
    "# Old",
    () => "New",
  );
  assert.equal(text("A.markdown"), "See [[Note#New]].\n");
  assert.equal(text("B.MD"), "See [[Note#New]].\n");
});

test("a linking note that cannot be saved is named to the user", async () => {
  const { text, errors } = await rename(
    { "Note.md": "# Old\n", "A.md": "See [[Note#Old]].\n" },
    "# Old",
    () => "New",
    { unsaveable: [uriOf("A.md")] },
  );
  assert.equal(text("A.md"), "See [[Note#New]].\n");
  assert.deepEqual(errors, [
    "The heading's links were updated in A.md, but could not be saved.",
  ]);
});

const LINKING_NOTE =
  "[a](Note.md#Old) [[Note#Old]] [[Note#Old|alias]] ![[Note#Old]]\n";

/**
 * Whether every link to a heading in `source` (a heading's own `[[Target]]`
 * is not one) reaches the heading at `headingFrom` in
 * `note`: its path through the vault's resolver, its `#subpath` through the
 * note's metadata (`noteFragment`, as backlinks and embeds read it) and as a
 * click follows it (`resolveNavigationTarget`, given the fragment as written).
 */
function assertLinksReach(
  source: { path: string; text: string },
  note: string,
  headingFrom: number,
) {
  const { index } = memoryVaults({
    "Note.md": note,
    [source.path]: source.text,
  });
  const links = [
    ...metadata(source.text).links,
    ...metadata(source.text).embeds,
  ].filter((link) => link.link.includes("#"));
  assert.ok(links.length > 0, source.text);
  for (const link of links) {
    const syntax = linkSyntax(link);
    const { path, subpath } =
      syntax === "wikilink"
        ? splitLinktext(link.link)
        : splitMarkdownDestination(link.link);
    if (path) {
      assert.equal(
        index.resolveLink(path, source.path, syntax)?.path,
        "Note.md",
        link.original,
      );
    }
    assert.equal(
      noteFragment(note, subpath.slice(1))?.from,
      headingFrom,
      `noteFragment: ${link.original}`,
    );
    const written = splitLinktext(link.link).subpath.slice(1);
    assert.equal(
      resolveNavigationTarget(EditorState.create({ doc: note }), written)?.from,
      headingFrom,
      `resolveNavigationTarget: ${link.original}`,
    );
  }
}

test("links to a heading renamed with a wikilink are written with its shown text, and reach it", async () => {
  const { text, applies, saved } = await rename(
    {
      "Note.md": "# Old\n\n[go](#Old) [[#Old]] [[#Old|here]]\n",
      "Other.md": LINKING_NOTE,
    },
    "# Old",
    () => "New [[Target|Alias]]",
  );
  assert.equal(
    text("Note.md"),
    "# New [[Target|Alias]]\n\n[go](#New%20Alias) [[#New Alias]] [[#New Alias|here]]\n",
  );
  assert.equal(
    text("Other.md"),
    "[a](Note.md#New%20Alias) [[Note#New Alias]] [[Note#New Alias|alias]] ![[Note#New Alias]]\n",
  );
  // The heading and its links in the note are one edit, so one undo step.
  assert.deepEqual(applies, [uriOf("Note.md"), uriOf("Other.md")]);
  assert.deepEqual(saved, [uriOf("Other.md")]);
});

test("links to a heading renamed with formatting reach it as the note's metadata reads it", async () => {
  for (const [name, shown] of [
    ["New [[Target|Alias]]", "New Alias"],
    ["[[Target|Alias]]", "Alias"],
    ["New [Label](target)", "New Label"],
    ["New [Label](target) and [[Other|More]]", "New Label and More"],
    ["New ![alt](img.png)", "New alt"],
    ["New ![[img.png]]", "New !img.png"],
    ["**Bold** `code` [[A|B: C]]", "Bold code B: C"],
    // Controls: a plain name, and a wikilink without an alias.
    ["New Alias", "New Alias"],
    ["New [[Target]]", "New Target"],
  ] as const) {
    const { text, applies } = await rename(
      {
        "Note.md": "Intro\n\n# Old\n\n[go](#Old) [[#Old]] [[#Old|here]]\n",
        "Other.md": LINKING_NOTE,
      },
      "# Old",
      () => name,
    );
    const note = text("Note.md")!;
    const heading = metadata(note).headings[0]!;
    assert.equal(heading.heading, shown, name);
    assert.equal(
      note.slice(heading.from, note.indexOf("\n", heading.from)),
      `# ${name}`,
    );
    assertLinksReach({ path: "Note.md", text: note }, note, heading.from);
    assertLinksReach(
      { path: "Other.md", text: text("Other.md")! },
      note,
      heading.from,
    );
    assert.deepEqual(applies, [uriOf("Note.md"), uriOf("Other.md")], name);
  }
});

test("a name no link to the heading could reach is refused, and nothing is renamed", async () => {
  const notes = {
    "Note.md": "# Intro\n\n# Old\n\n[go](#Old) [[#Old]]\n",
    "Other.md": "[[Note#Old]] [a](Note.md#Old)\n",
  };
  for (const [name, problem] of [
    // Its shown text is empty.
    ["![](img.png)", /only formatting/u],
    // A link would select line 12.
    ["L12", /line number/u],
    ["[[Target|L1-L3]]", /line number/u],
    // `%41` reads as an escape for `A`.
    ["a%41b", /could not reach/u],
  ] as const) {
    const { text, validations, informed, applies } = await rename(
      notes,
      "# Old",
      () => name,
    );
    assert.match(validations[0] ?? "", problem, name);
    assert.deepEqual(informed, [validations[0]], name);
    assert.deepEqual(applies, [], name);
    assert.equal(text("Note.md"), notes["Note.md"], name);
    assert.equal(text("Other.md"), notes["Other.md"], name);
  }
});

test("a name an earlier heading has is taken, as in Obsidian, and its links reach the first heading", async () => {
  const notes = {
    "Note.md": "# Intro\n\n# Old\n\n[go](#Old) [[#Old]]\n",
    "Other.md": "[[Note#Old]] [a](Note.md#Old)\n",
  };
  for (const [name, written] of [
    ["intro", "intro"],
    ["[[Target|Intro]]", "Intro"],
  ] as const) {
    const { text, validations, informed } = await rename(
      notes,
      "# Old",
      () => name,
    );
    assert.deepEqual(validations, [undefined], name);
    assert.deepEqual(informed, [], name);
    const note = text("Note.md")!;
    assert.equal(
      note,
      `# Intro\n\n# ${name}\n\n[go](#${written}) [[#${written}]]\n`,
    );
    assert.equal(
      text("Other.md"),
      `[[Note#${written}]] [a](Note.md#${written})\n`,
    );
    // Both headings read as `Intro` as links compare them; links reach the
    // first, as Obsidian's do.
    assertLinksReach({ path: "Note.md", text: note }, note, 0);
    assertLinksReach({ path: "Other.md", text: text("Other.md")! }, note, 0);
  }
});

test("the heading's current name passes the prompt, though it renames nothing", async () => {
  const { validations } = await rename(
    { "Note.md": "# Old [[A|B]]\n" },
    "# Old",
    () => "Old [[A|B]]",
  );
  assert.deepEqual(validations, [undefined]);
});
