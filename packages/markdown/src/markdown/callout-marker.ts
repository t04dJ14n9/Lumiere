/**
 * Whether a quote opens with a callout's `[!type]`, as Obsidian reads it: any
 * type but `]` (`[!note|wide]`, `[!笔记]`), then a space or the line's end.
 * Only the start of `source` is read.
 */
export function opensWithCalloutMarker(source: string): boolean {
  return /^\s*>\s*\[![^\]\n]+\][+-]?(?:\s|$)/.test(source);
}
