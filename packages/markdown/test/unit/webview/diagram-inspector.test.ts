import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { bindDiagramInspector } from "../../../src/plugins/diagrams/diagram-dialog";

/** A rendered Mermaid block with one SVG-text label. */
const DIAGRAM = `<section class="hybrid-block hybrid-diagram"><div class="markdown-rendered"><pre data-fence="mermaid"><svg viewBox="0 0 400 100"><g class="node"><rect></rect><text><tspan>Bravo step</tspan></text></g></svg></pre></div></section>`;

// jsdom accepts only its own AbortSignal in addEventListener.
const GLOBALS = [
  "document",
  "window",
  "Element",
  "HTMLElement",
  "AbortController",
] as const;

/** Open the inspector on a fresh document and hand over its parts. */
function withInspector(
  run: (parts: {
    window: JSDOM["window"];
    dialog: Element;
    area: HTMLElement;
  }) => void,
): void {
  const dom = new JSDOM(`<!doctype html><body>${DIAGRAM}</body>`);
  const globals = globalThis as Record<string, unknown>;
  const previous = GLOBALS.map((name) => globals[name]);
  for (const name of GLOBALS) {
    globals[name] =
      name === "window" ? dom.window : (dom.window as never)[name];
  }
  const controller = new dom.window.AbortController();
  try {
    const host = dom.window.document.querySelector("pre") as HTMLElement;
    bindDiagramInspector(host, controller.signal)!.click();
    const dialog = dom.window.document.querySelector("dialog")!;
    const area = dialog.querySelector(".media-area") as HTMLElement;
    run({ window: dom.window, dialog, area });
  } finally {
    controller.abort();
    GLOBALS.forEach((name, index) => {
      globals[name] = previous[index];
    });
  }
}

function press(target: Element, init: KeyboardEventInit): boolean {
  const window = target.ownerDocument.defaultView!;
  let reached = false;
  const listen = () => {
    reached = true;
  };
  window.addEventListener("keydown", listen);
  target.dispatchEvent(
    new window.KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ...init,
    }),
  );
  window.removeEventListener("keydown", listen);
  return reached;
}

test("the diagram inspector lets VS Code's shortcuts through and keeps its own keys", () => {
  withInspector(({ area }) => {
    assert.equal(
      press(area, { key: "b", ctrlKey: true, altKey: true }),
      true,
      "Ctrl+Alt+B reaches the window, where VS Code forwards it",
    );
    assert.equal(
      press(area, { key: "+" }),
      false,
      "zoom stays in the inspector",
    );
    assert.equal(
      press(area, { key: "Escape" }),
      false,
      "Escape only closes it",
    );
  });
});

test("a drag on a label in a zoomed diagram selects its text; elsewhere it pans", () => {
  withInspector(({ window, dialog, area }) => {
    const zoomIn = dialog.querySelector(
      '[aria-label="Zoom in"]',
    ) as HTMLElement;
    zoomIn.click();
    // jsdom has no layout: make the zoomed diagram overflow the area.
    Object.defineProperty(area, "scrollWidth", { value: 2000 });
    Object.defineProperty(area, "clientWidth", { value: 500 });
    const pointerDown = (target: Element): boolean =>
      target.dispatchEvent(
        new window.MouseEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      );
    assert.equal(pointerDown(dialog.querySelector("tspan")!), true);
    assert.equal(area.classList.contains("panning"), false);
    assert.equal(pointerDown(dialog.querySelector("rect")!), false);
    assert.equal(area.classList.contains("panning"), true);
  });
});
