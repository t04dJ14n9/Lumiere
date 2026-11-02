import {
  Language,
  LanguageSupport,
  indentNodeProp,
  languageDataProp,
} from "@codemirror/language";
import { markdownLanguage } from "@codemirror/lang-markdown";
import {
  Parser,
  TreeFragment,
  type Input,
  type PartialParse,
} from "@lezer/common";
import { markdownParser } from "./parser";

// Share lang-markdown's language data facet so its commands (list and
// quote continuation, markup deletion) recognise this dialect as Markdown.
const data = markdownLanguage.data;

const editorParser = markdownParser.configure([
  {
    props: [
      languageDataProp.add({ Document: data }),
      // No indentation of its own, as lang-markdown says: Enter then keeps
      // the line's indentation (in a code block too, as in Obsidian) rather
      // than going to column 0.
      indentNodeProp.add({ Document: () => null }),
    ],
  },
]);

/**
 * The parser CodeMirror's language runs: the editor's Markdown parser, with
 * one rule Lezer's reuse of old blocks does not know. Only the first line
 * can open frontmatter, so after an edit there the lines after it may have
 * become frontmatter or stopped being it: their old blocks are parsed again,
 * not reused. (CodeMirror cuts the old tree's fragments at the edit, so a
 * first line no fragment still covers is a first line that changed.)
 */
class EditorMarkdownParser extends Parser {
  createParse(
    input: Input,
    fragments: readonly TreeFragment[],
    ranges: readonly { from: number; to: number }[],
  ): PartialParse {
    return editorParser.createParse(
      input,
      afterFirstLineEdit(input, fragments),
      ranges,
    );
  }
}

export function afterFirstLineEdit(
  input: Input,
  fragments: readonly TreeFragment[],
): readonly TreeFragment[] {
  if (!fragments.length) {
    return fragments;
  }
  const end = Math.min(input.length, firstLineEnd(input) + 1);
  if (fragments.some((fragment) => fragment.from <= 0 && fragment.to >= end)) {
    return fragments;
  }
  return fragments.flatMap((fragment) =>
    fragment.to <= end
      ? []
      : [
          new TreeFragment(
            Math.max(fragment.from, end),
            fragment.to,
            fragment.tree,
            fragment.offset,
            true,
            fragment.openEnd,
          ),
        ],
  );
}

function firstLineEnd(input: Input): number {
  for (let from = 0; from < input.length;) {
    const chunk = input.chunk(from);
    if (!chunk) {
      break;
    }
    const at = chunk.indexOf("\n");
    if (at >= 0) {
      return from + at;
    }
    from += chunk.length;
  }
  return input.length;
}

/**
 * The one Markdown parser of an editor: CodeMirror's language keeps its
 * tree, and Live Preview reads that tree (`livePreview/api.ts`).
 */
export const editorMarkdownParser: Parser = new EditorMarkdownParser();

const language = new Language(data, editorMarkdownParser, [], "markdown");

export function markdownLanguageSupport(): LanguageSupport {
  return new LanguageSupport(language, [
    // Listed before lang-markdown's HTML comment tokens, so it wins.
    data.of({ commentTokens: { block: { open: "%%", close: "%%" } } }),
  ]);
}
