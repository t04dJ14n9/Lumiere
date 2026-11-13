import type { Plugin } from "@workshop/core";
import { markdownParser } from "../../markdown/dialect/parser";
import { markdownLanguageSupport } from "../../markdown/dialect/language";
import type { RendererOptions } from "../../markdown/html/types";
import type { createRenderer } from "../../markdown/html";
import type { MarkdownRenderer } from "./api";

type Renderer = ReturnType<typeof createRenderer>;

/**
 * Webview dialect: parser, CM language and HTML renderer. Full-document
 * metadata extraction (which pulls in the YAML runtime) stays out of the
 * initial editor bundle until lazy feature chunks load.
 *
 * The renderer is fetched with a dynamic import started here, during core
 * plugin apply, rather than as a static import of the entry. markdown-it and
 * its plugins are ~220 KB; no rendered block needs them before first paint, so
 * the editor entry must not wait for that chunk to evaluate. `render.into`
 * awaits `renderer.ready()` before its first render, by which time the import
 * has settled alongside the feature chunks.
 */
export function dialectPlugin(options: RendererOptions = {}): Plugin {
  return {
    name: "dialect",
    provides: ["markdown"],
    apply(ctx) {
      ctx.provide("markdown", {
        parser: markdownParser,
        language: markdownLanguageSupport,
        metadata: () => {
          throw new Error(
            "markdown.metadata is not available on the core dialect service",
          );
        },
        renderer: lazyRenderer(options),
      });
    },
  };
}

function lazyRenderer(options: RendererOptions): MarkdownRenderer {
  let renderer: Renderer | undefined;
  const loading = import("../../markdown/html").then((module) => {
    renderer = module.createRenderer(options);
  });
  const active = (): Renderer => {
    if (!renderer) {
      throw new Error(
        "The Markdown renderer is not loaded; await renderer.ready() first",
      );
    }
    return renderer;
  };
  return {
    ready: () => loading,
    renderMarkdown: (source, renderOptions) =>
      active().renderMarkdown(source, renderOptions),
    renderInline: (source, renderOptions) =>
      active().renderInline(source, renderOptions),
  };
}
