import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { DiagramRenderer } from "./renderer";

test("over-budget Sankey goes through capped render before either preparatory parser or node defaults", async () => {
  const dom = new JSDOM("");
  const previousDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document",
  );
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: dom.window.document,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: dom.window,
  });
  const { default: mermaid } = await import("mermaid");
  const initialize = mermaid.initialize;
  const parse = mermaid.parse;
  const api = mermaid.mermaidAPI;
  const render = mermaid.render;
  let preparatoryParses = 0;
  let graphParses = 0;
  let defaultsAtRender = -1;
  let received = "";
  const limitedSvg =
    "<svg><text>Maximum text size in diagram exceeded</text></svg>";
  // Scale the actual protected Mermaid budget down; never parse a large payload.
  mermaid.initialize = (config) => initialize({ ...config, maxTextSize: 64 });
  mermaid.parse = ((...args) => {
    preparatoryParses++;
    return parse(...args);
  }) as typeof parse;
  mermaid.mermaidAPI = {
    ...api,
    getDiagramFromText: (...args) => {
      graphParses++;
      return api.getDiagramFromText(...args);
    },
  };
  mermaid.render = (async (_id, source) => {
    received = source;
    defaultsAtRender = Object.keys(
      api.getSiteConfig().sankey?.nodeColors ?? {},
    ).length;
    // The existing public render contract substitutes a small non-Sankey diagram.
    return { svg: limitedSvg, diagramType: "flowchart-v2" };
  }) as typeof render;
  const renderer = new DiagramRenderer(
    { debug() {}, warn() {}, error() {} },
    undefined,
    undefined,
    (svg) => svg,
  );
  try {
    const source =
      "sankey-beta\n" +
      Array.from(
        { length: 12 },
        (_, index) => `Source${index},Target${index},1\n`,
      ).join("");
    assert.ok(source.length > 64 && source.length < 512);
    const draw = (
      renderer as unknown as {
        renderMermaidSvg: (source: string) => Promise<string>;
      }
    ).renderMermaidSvg.bind(renderer);
    assert.equal(await draw(source), limitedSvg);
    assert.equal(received, source);
    assert.equal(api.getSiteConfig().maxTextSize, 64);
    assert.equal(
      preparatoryParses,
      0,
      "no public parse before the ordinary render budget",
    );
    assert.equal(
      graphParses,
      0,
      "no graph extraction before the ordinary render budget",
    );
    assert.equal(
      defaultsAtRender,
      0,
      "no per-node defaults allocated before the ordinary render budget",
    );
  } finally {
    renderer.dispose();
    mermaid.initialize = initialize;
    mermaid.parse = parse;
    mermaid.mermaidAPI = api;
    mermaid.render = render;
    if (previousDocument) {
      Object.defineProperty(globalThis, "document", previousDocument);
    } else {
      Reflect.deleteProperty(globalThis, "document");
    }
    if (previousWindow) {
      Object.defineProperty(globalThis, "window", previousWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
    dom.window.close();
  }
});

test("raw-large but cleaned-small Sankey keeps editor defaults and authored colors after guarded rendering", async () => {
  const dom = new JSDOM("");
  const previousDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document",
  );
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: dom.window.document,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: dom.window,
  });
  const { default: mermaid } = await import("mermaid");
  const { categoryColors, readMermaidPalette } = await import("./theme");
  const initialize = mermaid.initialize;
  const parse = mermaid.parse;
  const render = mermaid.render;
  const seen: Array<Record<string, string> | undefined> = [];
  mermaid.initialize = (config) => initialize({ ...config, maxTextSize: 64 });
  mermaid.render = (async (_id, source) => {
    const parsed = await parse(source);
    assert.notEqual(parsed, false);
    seen.push(mermaid.mermaidAPI.getConfig().sankey?.nodeColors);
    return { svg: "<svg></svg>", diagramType: parsed && parsed.diagramType };
  }) as typeof render;
  const renderer = new DiagramRenderer(
    { debug() {}, warn() {}, error() {} },
    undefined,
    undefined,
    (svg) => svg,
  );
  try {
    const source =
      "---\nconfig:\n  sankey:\n    nodeColors:\n      Target: '#ff0000'\n---\n%% " +
      "comment ".repeat(20) +
      "\nsankey-beta\nSource,Target,1\n";
    const draw = (
      renderer as unknown as {
        renderMermaidSvg: (source: string) => Promise<string>;
      }
    ).renderMermaidSvg.bind(renderer);
    assert.ok(source.length > 64 && source.length < 512);
    assert.equal(await draw(source), "<svg></svg>");
    assert.equal(
      seen.length,
      2,
      "ordinary capped render precedes preparation for raw-large source",
    );
    assert.equal(
      seen[1]?.Source,
      categoryColors(
        readMermaidPalette(dom.window.document as unknown as Document),
      )[0],
    );
    assert.equal(seen[1]?.Target, "#ff0000");
  } finally {
    renderer.dispose();
    mermaid.initialize = initialize;
    mermaid.render = render;
    if (previousDocument) {
      Object.defineProperty(globalThis, "document", previousDocument);
    } else {
      Reflect.deleteProperty(globalThis, "document");
    }
    if (previousWindow) {
      Object.defineProperty(globalThis, "window", previousWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
    dom.window.close();
  }
});
