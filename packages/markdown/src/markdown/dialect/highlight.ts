import type { MarkdownConfig } from "@lezer/markdown";
const highlightDelimiter = { resolve: "Highlight", mark: "HighlightMark" };
export const highlight: MarkdownConfig = {
  defineNodes: ["Highlight", "HighlightMark"],
  parseInline: [
    {
      name: "Highlight",
      before: "Escape",
      parse(cx, next, pos) {
        if (next !== 61 || cx.char(pos + 1) !== 61) {
          return -1;
        }
        return cx.addDelimiter(
          highlightDelimiter,
          pos,
          pos + 2,
          !/\s/.test(cx.slice(pos + 2, pos + 3)),
          pos > cx.offset && !/\s/.test(cx.slice(pos - 1, pos)),
        );
      },
    },
  ],
};

/**
 * Obsidian's highlight colours: one of these emoji right after the opening
 * `==` colours the highlight (`==🔵text==`); any other text does not. The
 * colour commands write these.
 */
export const HIGHLIGHT_COLOURS = {
  red: "\u{1F534}",
  orange: "\u{1F7E0}",
  yellow: "\u{1F7E1}",
  green: "\u{1F7E2}",
  blue: "\u{1F535}",
  purple: "\u{1F7E3}",
} as const;

export type HighlightColour = keyof typeof HIGHLIGHT_COLOURS;

/**
 * The square emoji Obsidian 1.15 also reads as the same colours
 * (`==🟥text==` is red), though its commands write the round ones.
 */
const SQUARE_COLOURS: Readonly<Record<HighlightColour, string>> = {
  red: "\u{1F7E5}",
  orange: "\u{1F7E7}",
  yellow: "\u{1F7E8}",
  green: "\u{1F7E9}",
  blue: "\u{1F7E6}",
  purple: "\u{1F7EA}",
};

const byEmoji = new Map<string, HighlightColour>(
  [HIGHLIGHT_COLOURS, SQUARE_COLOURS].flatMap((emoji) =>
    Object.entries(emoji).map(
      ([colour, char]) => [char, colour as HighlightColour] as const,
    ),
  ),
);

/** Every emoji that colours a highlight, round and square. */
export const HIGHLIGHT_COLOUR_EMOJI: readonly string[] = [...byEmoji.keys()];

/**
 * The colour whose emoji starts `text` at `at`, if one does. Every colour
 * emoji is two UTF-16 units long.
 */
export function highlightColourAt(
  text: string,
  at = 0,
): HighlightColour | undefined {
  return byEmoji.get(text.slice(at, at + 2));
}
