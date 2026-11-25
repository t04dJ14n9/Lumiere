import type { MarkdownIt } from "markdown-it";
import type { StateCore } from "markdown-it";
import type { Token } from "markdown-it";
import { t } from "@workshop/l10n";
const calloutAliases: Record<string, string> = {
  summary: "abstract",
  tldr: "abstract",
  hint: "tip",
  important: "tip",
  check: "success",
  done: "success",
  help: "question",
  faq: "question",
  caution: "warning",
  attention: "warning",
  fail: "failure",
  missing: "failure",
  error: "danger",
  cite: "quote",
};
interface Callout {
  /** The main type, for the icon: `abstract` for `tldr`. */
  kind: string;
  /**
   * The type as written, lowercased: `data-callout` keeps it, as Obsidian
   * does, so CSS snippets can select `[data-callout="tldr"]`.
   */
  type: string;
  title: string;
  fold?: string;
  /** What follows the type's `|`, for CSS snippets: `[!note|wide]`. */
  metadata?: string;
}
export function callouts(
  md: MarkdownIt,
  calloutIcon: (kind: string) => string = () => "",
): void {
  md.core.ruler.after("inline", "callouts", (state) => {
    for (let index = 0; index < state.tokens.length; index++) {
      transformCallout(md, state, index);
    }
  });
  md.renderer.rules.callout_open = (tokens, index, _options, env) => {
    const data = tokens[index]!.meta as unknown as Callout;
    const title = md.renderInline(data.title, env);
    const heading = `${calloutIcon(data.kind)}<span class="callout-title-text">${title}</span>`;
    const { escapeHtml } = md.utils;
    const attributes = `class="callout" data-callout="${escapeHtml(data.type)}"${
      data.metadata === undefined
        ? ""
        : ` data-callout-metadata="${escapeHtml(data.metadata)}"`
    }`;
    return data.fold
      ? `<details ${attributes}${data.fold === "+" ? " open" : ""}><summary class="callout-title">${heading}<button type="button" class="callout-fold" aria-label="${escapeHtml(t("Toggle callout"))}">›</button></summary><div class="callout-content">`
      : `<aside ${attributes}><div class="callout-title">${heading}</div><div class="callout-content">`;
  };
  md.renderer.rules.callout_close = (tokens, index) =>
    `</div></${(tokens[index]!.meta as unknown as Callout).fold ? "details" : "aside"}>`;
}

function transformCallout(
  md: MarkdownIt,
  state: StateCore,
  index: number,
): void {
  const token = state.tokens[index]!;
  if (token.type !== "blockquote_open") {
    return;
  }
  const paragraph = state.tokens[index + 1];
  const inline = state.tokens[index + 2];
  if (paragraph?.type !== "paragraph_open" || inline?.type !== "inline") {
    return;
  }
  // `[^\S\n]` is any space but the newline: Obsidian's `\s` after the type
  // takes a non-breaking or ideographic space too, as `isCallout` does.
  const match = /^\[!([^\]\n]+)\]([+-])?(?:[^\S\n]+([^\n]*))?(?:\n|$)/.exec(
    inline.content,
  );
  if (!match) {
    return;
  }
  const closing = closingQuote(state.tokens, index);
  token.type = "callout_open";
  token.meta = { ...calloutData(match) };
  const close = state.tokens[closing];
  if (close) {
    close.type = "callout_close";
    close.meta = { ...calloutData(match) };
  }
  inline.content = inline.content.slice(match[0].length);
  inline.children = [];
  md.inline.parse(inline.content, md, state.env, inline.children);
  if (!inline.content) {
    paragraph.hidden = true;
    state.tokens[index + 3]!.hidden = true;
  }
}

function closingQuote(tokens: Token[], index: number): number {
  let depth = 1;
  let closing = index + 1;
  for (; closing < tokens.length; closing++) {
    if (tokens[closing]!.type === "blockquote_open") {
      depth++;
    }
    if (tokens[closing]!.type === "blockquote_close" && --depth === 0) {
      break;
    }
  }
  return closing;
}

/** A callout without a title shows its type, capitalised, hyphens as spaces. */
function defaultTitle(type: string): string {
  const words = type.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * `[!type|metadata]` as Obsidian reads it: the type lowercased, its runs of
 * spaces as hyphens, and anything after the first `|` its metadata.
 */
function calloutData(match: RegExpExecArray): Callout {
  const [type = "", ...metadata] = match[1]!.split("|");
  const raw = type.trim().toLowerCase().replace(/\s+/g, "-");
  // Own keys only: `constructor` and `__proto__` are types, not inherited members.
  const canonical = Object.hasOwn(calloutAliases, raw)
    ? calloutAliases[raw]!
    : raw;
  const fold = match[2];
  return {
    kind: canonical,
    type: raw,
    title: match[3] || defaultTitle(raw),
    ...(fold === undefined ? {} : { fold }),
    ...(metadata.length ? { metadata: metadata.join("|") } : {}),
  };
}
