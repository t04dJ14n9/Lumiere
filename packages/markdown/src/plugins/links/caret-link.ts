import type { EditorView } from "@codemirror/view";
import type { Tree } from "@lezer/common";
import { markdownParser } from "../../markdown/dialect";
import { linkDestination } from "../../markdown/html/helpers";

export function linkAt(
  text: string,
  at: number,
): { href: string; wiki: boolean } | undefined {
  let found: { href: string; wiki: boolean } | undefined;
  markdownParser.parse(text).iterate({
    enter(node) {
      if (node.from > at || node.to < at) {
        return false;
      }
      if (node.name === "Image") {
        return false;
      }
      if (node.name === "WikiLink") {
        found = {
          href: text.slice(node.from + 2, node.to - 2).split("|")[0]!,
          wiki: true,
        };
      }
      if (node.name === "URL" && !found) {
        found = { href: text.slice(node.from, node.to), wiki: false };
      }
      if (node.name === "Link") {
        const url = node.node.getChild("URL");
        if (url) {
          found = { href: text.slice(url.from, url.to), wiki: false };
        }
      }
      return undefined;
    },
  });
  return found;
}
/** A reference label as CommonMark matches it: case and runs of spaces ignored. */
const normalLabel = (label: string): string =>
  label.trim().replace(/\s+/g, " ").toLowerCase();

/** The label, as written, of the full or collapsed reference link at `at`. */
function referenceLabelAt(
  tree: Tree,
  text: string,
  at: number,
): string | undefined {
  let label: string | undefined;
  tree.iterate({
    enter(node) {
      if (node.from > at || node.to < at || node.name === "Image") {
        return false;
      }
      const reference = node.node.getChild("LinkLabel");
      if (node.name !== "Link" || !reference || node.node.getChild("URL")) {
        return undefined;
      }
      const textEnd = node.node.getChildren("LinkMark")[1];
      const written = text.slice(reference.from + 1, reference.to - 1);
      label = written.trim() || text.slice(node.from + 1, textEnd?.from);
      return false;
    },
  });
  return label;
}

/**
 * The destination of the first definition of `label` in `tree`, the parse of
 * `text`; one in a quote or list counts.
 */
function definitionOf(
  tree: Tree,
  text: string,
  label: string,
): string | undefined {
  const wanted = normalLabel(label);
  let href: string | undefined;
  tree.iterate({
    enter(node) {
      if (href !== undefined) {
        return false;
      }
      if (node.name !== "LinkReference") {
        return undefined;
      }
      const name = node.node.getChild("LinkLabel");
      const url = node.node.getChild("URL");
      if (
        name &&
        url &&
        normalLabel(text.slice(name.from + 1, name.to - 1)) === wanted
      ) {
        href = linkDestination(text.slice(url.from, url.to));
      }
      return false;
    },
  });
  return href;
}

/**
 * The destination of the full or collapsed reference link at `at` (`[text][label]`,
 * `[text][]`), from the note's definition of that label (`[label]: url`), as
 * Obsidian's Follow link resolves it. A shortcut `[label]` is not followed,
 * nor a label the note does not define.
 *
 * `text` is what the caret is in and `note` the note that holds the
 * definitions. They differ for a table cell's editor, whose text is the
 * cell alone: a definition cannot be written in a cell, so only the note's
 * count. A note is `text` itself when omitted.
 */
export function referenceLinkAt(
  text: string,
  at: number,
  note: string = text,
): { href: string; wiki: false } | undefined {
  const tree = markdownParser.parse(text);
  const label = referenceLabelAt(tree, text, at);
  if (label === undefined) {
    return undefined;
  }
  const definitions = note === text ? tree : markdownParser.parse(note);
  const href = definitionOf(definitions, note, label);
  return href === undefined ? undefined : { href, wiki: false };
}

/**
 * The link Obsidian's Follow Link commands take at `at`: a wikilink, inline
 * link or bare URL, else a full or collapsed reference link, whose definition
 * is read from `note` (see `referenceLinkAt`).
 */
export function caretLinkAt(
  text: string,
  at: number,
  note: string = text,
): { href: string; wiki: boolean } | undefined {
  return linkAt(text, at) ?? referenceLinkAt(text, at, note);
}

/**
 * Whether a key typed in `view` belongs to the link at its caret. Each editor
 * owns its caret: prompts, property inputs and another editor must not
 * follow the outer caret's link. Enter also commits IME composition, and a
 * selection leaves the key to other handlers.
 */
export function ownsCaretKey(view: EditorView): boolean {
  return (
    view.dom.ownerDocument.activeElement === view.contentDOM &&
    !view.composing &&
    view.state.selection.main.empty
  );
}
