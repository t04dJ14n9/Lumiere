import type { MarkdownIt } from "markdown-it";
import { attr, escape, rememberedIndexOf, wikiTarget } from "./helpers";
import type { WikiTarget } from "./helpers";
const closerFrom = rememberedIndexOf("]]");
const newlineFrom = rememberedIndexOf("\n");
export function wiki(md: MarkdownIt): void {
  md.inline.ruler.before("link", "wiki-link", (state, silent) => {
    const embed = state.src.startsWith("![[", state.pos);
    if (!embed && !state.src.startsWith("[[", state.pos)) {
      return false;
    }
    const start = state.pos + (embed ? 3 : 2);
    const end = closerFrom(state, start);
    const newline = newlineFrom(state, start);
    if (end < 0 || (newline >= 0 && newline < end)) {
      return false;
    }
    if (!silent) {
      const parsed = wikiTarget(state.src.slice(start, end));
      const token = state.push(embed ? "wiki_embed" : "wiki_link", "", 0);
      token.content = parsed.label;
      token.meta = { ...parsed };
    }
    state.pos = end + 2;
    return true;
  });
  md.renderer.rules.wiki_link = (tokens, index) => {
    const token = tokens[index]!;
    const link = token.meta as unknown as WikiTarget;
    return `<a class="internal-link" data-wiki="true"${attr("data-href", link.target)}${attr("href", link.target)}>${escape(link.label)}</a>`;
  };
  md.renderer.rules.wiki_embed = (tokens, index) => {
    const link = tokens[index]!.meta as unknown as WikiTarget;
    return `<span class="file-embed" data-wiki="true"${attr("data-resource", link.target)}${attr("data-width", link.width)}${attr("data-height", link.height)}>${escape(link.target)}</span>`;
  };
}
