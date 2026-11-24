import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { isNativeSelectableLabelTarget } from "../../../src/webview/ui/block-pointer";

/**
 * A rendered Mermaid block as the editor holds it. Trusted diagrams
 * (`htmlLabels`) draw a node's label as HTML inside a `<foreignObject>`;
 * untrusted ones as SVG `<text>`.
 */
const DIAGRAM = `<section class="hybrid-block hybrid-diagram"><div class="markdown-rendered"><pre data-fence="mermaid"><svg><g class="node"><rect></rect><foreignObject><div><span class="nodeLabel"><p>Alpha step</p></span></div></foreignObject></g><g class="node"><rect></rect><text><tspan>Bravo step</tspan></text></g></svg></pre></div></section>`;

function withDiagram(run: (root: Document) => void): void {
  const dom = new JSDOM(`<!doctype html><body>${DIAGRAM}</body>`);
  const globals = globalThis as Record<string, unknown>;
  const previous = {
    Element: globals.Element,
    HTMLElement: globals.HTMLElement,
  };
  globals.Element = dom.window.Element;
  globals.HTMLElement = dom.window.HTMLElement;
  try {
    run(dom.window.document);
  } finally {
    globals.Element = previous.Element;
    globals.HTMLElement = previous.HTMLElement;
  }
}

test("an HTML label in a trusted diagram's foreignObject selects as text", () => {
  withDiagram((document) => {
    assert.equal(
      isNativeSelectableLabelTarget(document.querySelector("p")),
      true,
    );
    assert.equal(
      isNativeSelectableLabelTarget(document.querySelector("span")),
      true,
    );
  });
});

test("an SVG text label selects as text, and a node's shape does not", () => {
  withDiagram((document) => {
    assert.equal(
      isNativeSelectableLabelTarget(document.querySelector("tspan")),
      true,
    );
    assert.equal(
      isNativeSelectableLabelTarget(document.querySelector("rect")),
      false,
    );
  });
});
