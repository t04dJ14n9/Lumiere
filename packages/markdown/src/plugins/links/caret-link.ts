import type { EditorView } from "@codemirror/view";
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

/**
 * The destination of the full or collapsed reference link at `at` (`[text][label]`,
 * `[text][]`), from the note's definition of that label (`[label]: url`), as
 * Obsidian's Follow link resolves it. A shortcut `[label]` is not followed,
 * nor a label the note does not define.
 */
export function referenceLinkAt(
  text: string,
  at: number,
): { href: string; wiki: false } | undefined {
  const tree = markdownParser.parse(text);
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
  if (label === undefined) {
    return undefined;
  }
  const wanted = normalLabel(label);
  // The first definition of a label wins; one in a quote or list counts.
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
  return href === undefined ? undefined : { href, wiki: false };
}

export function followCaretLink(
  view: EditorView,
  open: (href: string, wiki: boolean) => Promise<boolean>,
  report: (error: unknown) => void,
): boolean {
  // Each editor owns its caret: prompts, property inputs and another editor
  // must not follow the outer caret's link. Enter also commits IME composition.
  if (
    view.dom.ownerDocument.activeElement !== view.contentDOM ||
    view.composing ||
    !view.state.selection.main.empty
  ) {
    return false;
  }
  const link = linkAt(
    view.state.doc.toString(),
    view.state.selection.main.head,
  );
  if (!link) {
    return false;
  }
  void open(link.href, link.wiki).catch(report);
  return true;
}
