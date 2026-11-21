import test from "node:test";
import assert from "node:assert/strict";
import { linkParts, externalScheme } from "./target";
import { linkAt } from "./webview";
import { protocol } from "./protocol";
import { followCaretLink, referenceLinkAt } from "./caret-link";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
test("links retain aliases, Unicode fragments and source caret identity", () => {
  assert.deepEqual(linkParts("Note%20one#Hello%20there|alias"), {
    path: "Note one",
    fragment: "Hello%20there",
  });
  assert.deepEqual(linkAt("[[Note#^id|alias]]", 10), {
    href: "Note#^id",
    wiki: true,
  });
  assert.deepEqual(linkAt("[label](https://example.com)", 4), {
    href: "https://example.com",
    wiki: false,
  });
  assert.equal(linkAt("`[[not a link]]`", 5), undefined);
});

test("caret following keeps focus, composition and collapsed-selection guards for every editor", () => {
  for (const guard of ["focus", "composition", "selection", "no link"]) {
    const contentDOM = {};
    const state = EditorState.create({
      doc: guard === "no link" ? "plain text" : "[[Target]]",
      selection: { anchor: 3, head: guard === "selection" ? 5 : 3 },
    });
    const view = {
      state,
      contentDOM,
      composing: guard === "composition",
      dom: {
        ownerDocument: { activeElement: guard === "focus" ? {} : contentDOM },
      },
    } as unknown as EditorView;
    assert.equal(
      followCaretLink(
        view,
        async () => {
          assert.fail("Should not open");
        },
        () => {
          assert.fail("Should not report");
        },
      ),
      false,
      guard,
    );
  }
});
test("link requests reject malformed values and ambiguous paths", () => {
  assert.throws(() => linkParts("bad%00path"));
  assert.throws(() => linkParts("bad%255cpath"));
  assert.throws(() => linkParts("bad%"));
  assert.equal(externalScheme("ZOTERO://select/item"), "zotero");
  assert.equal(externalScheme("../note"), undefined);
  assert.throws(() =>
    protocol.requests.open.params.parse({ href: "x", side: "yes" }),
  );
});

test("caret following supports bare URLs and autolinks without following images or code", () => {
  for (const text of [
    "https://example.com/path",
    "<https://example.com/path>",
  ]) {
    assert.deepEqual(linkAt(text, 8), {
      href: "https://example.com/path",
      wiki: false,
    });
  }
  assert.equal(linkAt("![image](https://example.com)", 15), undefined);
  assert.equal(linkAt("`https://example.com`", 8), undefined);
});

test("Follow Link's reference links take the note's definition, as Obsidian's command does", () => {
  const text = [
    "a [text][Ref] b [Other][] c [ref] d [x][missing]",
    "",
    "> [quoted][ref]",
    "",
    '[REF]:  https://example.com/a "Title"',
    "[other]: <Note one.md>",
    "[ref]: https://example.com/second",
  ].join("\n");
  const at = (needle: string) => text.indexOf(needle) + 1;
  assert.deepEqual(referenceLinkAt(text, at("text]")), {
    href: "https://example.com/a",
    wiki: false,
  });
  // The label part counts, and its case and spaces do not.
  assert.deepEqual(referenceLinkAt(text, at("Ref]")), {
    href: "https://example.com/a",
    wiki: false,
  });
  assert.deepEqual(referenceLinkAt(text, at("Other]")), {
    href: "Note%20one.md",
    wiki: false,
  });
  assert.deepEqual(referenceLinkAt(text, at("quoted")), {
    href: "https://example.com/a",
    wiki: false,
  });
  // A shortcut reference, an undefined label and plain text are not followed.
  assert.equal(referenceLinkAt(text, at("ref] d")), undefined);
  assert.equal(referenceLinkAt(text, at("x][missing")), undefined);
  assert.equal(referenceLinkAt(text, 0), undefined);
  // An inline link is linkAt's, not a reference.
  assert.equal(referenceLinkAt("[l](https://e.com)", 2), undefined);
});
