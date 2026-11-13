import type { markdownParser } from "../../markdown/dialect/parser";
import type { markdownLanguageSupport } from "../../markdown/dialect/language";
import type { metadata } from "../../markdown/metadata";
import type { createRenderer } from "../../markdown/html";

/**
 * The HTML renderer is a lazy module in the webview: markdown-it and its
 * plugins are ~220 KB and no rendered block needs them before first paint.
 * `ready()` resolves once the module has loaded; a consumer must await it
 * before calling the synchronous render methods. The host stub resolves at
 * once and renders nothing.
 */
export interface MarkdownRenderer {
  ready(): Promise<void>;
  renderMarkdown: ReturnType<typeof createRenderer>["renderMarkdown"];
  renderInline: ReturnType<typeof createRenderer>["renderInline"];
}

export interface MarkdownService {
  parser: typeof markdownParser;
  language: typeof markdownLanguageSupport;
  metadata: typeof metadata;
  renderer: MarkdownRenderer;
}
declare module "@workshop/core" {
  interface Services {
    markdown: MarkdownService;
  }
}
