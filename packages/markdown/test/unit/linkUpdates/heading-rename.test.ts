import test from "node:test";
import assert from "node:assert/strict";
import {
  headingAt,
  headingLinkEdits,
  headingSubpath,
  type RenamedHeading,
} from "../../../src/plugins/linkUpdates/heading-rename";
import { metadata } from "../../../src/markdown/metadata";
import { noteFragment } from "../../../src/markdown/metadata/fragments";
import { linkSyntax } from "../../../src/markdown/metadata/linkpaths";
import {
  splitLinktext,
  splitMarkdownDestination,
} from "../../../src/shared/vault-path";
import { headingNameProblem } from "../../../src/plugins/linkUpdates/rename-heading";

// Expected notes are Obsidian's, measured with its Rename heading in a
// throwaway vault (2026-10-17).
const PROBE =
  "# Top\n\n## Old Name\n\ntext [[#Old Name]] and [x](#Old%20Name)\n\n### Sub\n\nbody";
const OTHER =
  "[[probe#Old Name]] [[probe#Old Name|alias]] [y](probe.md#Old%20Name) [[probe#Old Name#Sub]] [[probe#Top#Old Name]] [[probe#old name]] ![[probe#Old Name]]";

function apply(
  text: string,
  edits: { from: number; to: number; insert: string }[],
) {
  for (const edit of [...edits].sort((a, b) => b.from - a.from)) {
    text = text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
  }
  return text;
}

const resolve = (linkpath: string) =>
  linkpath.replace(/\.md$/u, "") === "probe" ? "probe.md" : undefined;

test("the heading at the caret is an ATX heading the note has, not a # line in code", () => {
  const heading = headingAt(PROBE, PROBE.indexOf("Old Name") + 2)!;
  assert.equal(heading.name, "Old Name");
  assert.equal(PROBE.slice(heading.nameFrom, heading.nameTo), "Old Name");
  assert.equal(headingAt(PROBE, PROBE.indexOf("text")), undefined);
  assert.equal(headingAt("```\n# not a heading\n```", 6), undefined);
  assert.equal(headingAt("## Closed ##", 4)?.name, "Closed");
});

test("renaming a heading updates the links to it in the note and in other notes, as Obsidian does", () => {
  const heading = headingAt(PROBE, PROBE.indexOf("Old Name"))!;
  const renamed: RenamedHeading = {
    path: "probe.md",
    text: PROBE,
    heading,
    name: "New Name",
  };
  const own = apply(PROBE, [
    { from: heading.nameFrom, to: heading.nameTo, insert: "New Name" },
    ...headingLinkEdits(PROBE, "probe.md", renamed, resolve),
  ]);
  assert.equal(
    own,
    "# Top\n\n## New Name\n\ntext [[#New Name]] and [x](#New%20Name)\n\n### Sub\n\nbody",
  );
  assert.equal(
    apply(OTHER, headingLinkEdits(OTHER, "other.md", renamed, resolve)),
    "[[probe#New Name]] [[probe#New Name|alias]] [y](probe.md#New%20Name) [[probe#Old Name#Sub]] [[probe#Top#Old Name]] [[probe#New Name]] ![[probe#New Name]]",
  );
});

test("any heading name is accepted, as in Obsidian, unless no link could reach it", () => {
  assert.equal(headingNameProblem("Fine name"), undefined);
  assert.ok(headingNameProblem("  "));
  for (const name of ["a#b", "a|b", "a^b", "a[b", "a]b", "[[x]]"]) {
    assert.equal(headingNameProblem(name), undefined, name);
  }
  assert.ok(headingNameProblem("#|^"));
});

// Obsidian 1.15.0 (read in its shipped code) writes the new name into links
// with : # | ^ \ line breaks %% [[ ]] as spaces; links match headings with
// punctuation read as spaces, so they still reach it.
test("links to a heading renamed with characters links cannot hold still reach it", () => {
  const heading = headingAt(PROBE, PROBE.indexOf("Old Name"))!;
  const links =
    "[[probe#Old Name]] [[probe#Old Name|alias]] [y](probe.md#Old%20Name) [z](<probe.md#Old Name>)";
  for (const name of [
    "A | B",
    "C# notes",
    "x ^ y",
    "[draft] plan",
    "a [[b]] c",
    "Q: why?",
    "100% done",
    "f(x) = (y",
    "x > y",
  ]) {
    const renamed: RenamedHeading = {
      path: "probe.md",
      text: PROBE,
      heading,
      name,
    };
    const note = apply(PROBE, [
      { from: heading.nameFrom, to: heading.nameTo, insert: name },
    ]);
    const updated = apply(
      links,
      headingLinkEdits(links, "other.md", renamed, resolve),
    );
    const found = [...metadata(updated).links];
    assert.equal(found.length, 4, `${name}: ${updated}`);
    for (const link of found) {
      const { subpath } =
        linkSyntax(link) === "wikilink"
          ? splitLinktext(link.link)
          : splitMarkdownDestination(link.link);
      assert.equal(
        noteFragment(note, subpath.slice(1))?.from,
        heading.from,
        `${name}: ${link.original}`,
      );
    }
  }
});

test("a heading's links get its name as Obsidian writes it, encoded where Markdown needs it", () => {
  assert.equal(headingSubpath("A | B: c#d ^e"), "A B c d e");
  const heading = headingAt(PROBE, PROBE.indexOf("Old Name"))!;
  const renamed: RenamedHeading = {
    path: "probe.md",
    text: PROBE,
    heading,
    name: "f(x) | 5%",
  };
  const links =
    "[[probe#Old Name]] [y](probe.md#Old%20Name) [z](<probe.md#Old Name>)";
  assert.equal(
    apply(links, headingLinkEdits(links, "other.md", renamed, resolve)),
    "[[probe#f(x) 5%]] [y](probe.md#f%28x%29%205%25) [z](<probe.md#f(x) 5%25>)",
  );
});

test("a renamed heading keeps a table row's escaped pipe, angle brackets and titles", () => {
  const heading = headingAt(PROBE, PROBE.indexOf("Old Name"))!;
  const renamed: RenamedHeading = {
    path: "probe.md",
    text: PROBE,
    heading,
    name: "New Name",
  };
  const text = [
    "| [[probe#Old Name\\|alias]] | b |",
    "| - | - |",
    '[a](<probe.md#Old Name>) [b](probe.md#Old%20Name "Title")',
  ].join("\n");
  assert.equal(
    apply(text, headingLinkEdits(text, "other.md", renamed, resolve)),
    [
      "| [[probe#New Name\\|alias]] | b |",
      "| - | - |",
      '[a](<probe.md#New Name>) [b](probe.md#New%20Name "Title")',
    ].join("\n"),
  );
});

test("a renamed heading's link keeps a title with escaped quotes", () => {
  const heading = headingAt(PROBE, PROBE.indexOf("Old Name"))!;
  const renamed: RenamedHeading = {
    path: "probe.md",
    text: PROBE,
    heading,
    name: "New Name",
  };
  const text = '[a](probe.md#Old%20Name "Say \\"hello\\"")';
  assert.equal(
    apply(text, headingLinkEdits(text, "other.md", renamed, resolve)),
    '[a](probe.md#New%20Name "Say \\"hello\\"")',
  );
});

test("a renamed heading's link to a file with # in its name is read from its encoded path", () => {
  const text = "# Old Name\n";
  const renamed: RenamedHeading = {
    path: "probe#1.md",
    text,
    heading: headingAt(text, 2)!,
    name: "New Name",
  };
  const resolveByPath = (linkpath: string) =>
    ["probe.md", "probe#1.md"].find((path) => path === linkpath);
  const links = "[a](probe%231.md#Old%20Name) [b](probe.md#Old%20Name)";
  assert.equal(
    apply(links, headingLinkEdits(links, "other.md", renamed, resolveByPath)),
    "[a](probe%231.md#New%20Name) [b](probe.md#Old%20Name)",
  );
});
