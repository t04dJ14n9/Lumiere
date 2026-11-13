import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "@workshop/core";
import { createRenderer } from "../../markdown/html";
import type { MarkdownRenderer } from "./api";
import { dialectPlugin } from "./webview-definition";

test("the webview dialect loads markdown-it on demand and renders identically", async () => {
  const root = createRoot();
  let renderer: MarkdownRenderer | undefined;
  root.plugin(dialectPlugin());
  root.plugin({
    name: "renderer-probe",
    inject: { required: ["markdown"] },
    apply(ctx) {
      renderer = ctx.markdown.renderer;
    },
  });
  await root.settled();
  assert.ok(renderer, "the dialect provides a renderer");
  await renderer.ready();

  const source = "# Title\n\nSome **bold** text and a [[Note|alias]].";
  const reference = createRenderer();
  assert.equal(
    renderer.renderMarkdown(source),
    reference.renderMarkdown(source),
  );
  assert.equal(
    renderer.renderInline("**bold**"),
    reference.renderInline("**bold**"),
  );
  assert.match(renderer.renderMarkdown(source), /<h1[^>]*>Title<\/h1>/);
});
