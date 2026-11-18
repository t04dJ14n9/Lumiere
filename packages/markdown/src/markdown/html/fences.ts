import type { MarkdownIt } from "markdown-it";
import { attr, encodeDataValue, escape } from "./helpers";
export function fences(md: MarkdownIt): void {
  md.renderer.rules.fence = (tokens, index) => {
    const token = tokens[index]!;
    const language = token.info.trim().split(/\s+/)[0] ?? "";
    return `<pre${attr("data-fence", language.toLowerCase())}${attr("data-source", encodeDataValue(token.content))}><code${attr("class", language ? `language-${language.toLowerCase()}` : "")}>${escape(token.content)}</code></pre>`;
  };
}
