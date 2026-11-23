import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import {
  readMermaidPalette,
  mermaidThemeVariables,
  mermaidCacheKey,
  watchMermaidTheme,
} from "./theme";
import { DiagramRenderer } from "./renderer";

function themedDocument() {
  const dom = new JSDOM("");
  const document = dom.window.document;
  document.body.className = "vscode-light";
  document.body.style.cssText =
    "--vscode-editor-background:#fafafa;--vscode-editor-foreground:rgb(20, 20, 20)";
  return { dom, document: document as unknown as Document };
}

test("palette uses actual editor colors in light, dark and high contrast", () => {
  const { dom, document } = themedDocument();
  try {
    assert.equal(readMermaidPalette(document).background, "#fafafa");
    assert.equal(readMermaidPalette(document).foreground, "#141414");
    document.body.className = "vscode-dark";
    document.body.style.cssText =
      "--vscode-editor-background:#121212;--vscode-editor-foreground:#ddd";
    const dark = readMermaidPalette(document);
    assert.equal(dark.background, "#121212");
    assert.equal(dark.foreground, "#dddddd");
    assert.equal(dark.darkMode, true);
    document.body.className = "vscode-high-contrast";
    document.body.style.setProperty("--vscode-contrastBorder", "#ff0");
    const contrast = readMermaidPalette(document);
    assert.equal(contrast.border, "#ffff00");
    assert.equal(contrast.surface, contrast.background);
    document.body.className = "vscode-high-contrast-light";
    assert.equal(readMermaidPalette(document).darkMode, false);
  } finally {
    dom.window.close();
  }
});

test("default variables cover flow, class, state, ER, sequence and color-scale families", () => {
  const { dom, document } = themedDocument();
  try {
    const palette = readMermaidPalette(document);
    const variables = mermaidThemeVariables(palette);
    for (const key of [
      "primaryColor",
      "secondaryColor",
      "tertiaryColor",
      "mainBkg",
      "nodeBkg",
      "actorBkg",
      "noteBkgColor",
    ]) {
      assert.equal(variables[key], palette.surface, key);
    }
    for (const key of [
      "lineColor",
      "textColor",
      "primaryTextColor",
      "actorTextColor",
      "transitionColor",
      "relationColor",
    ]) {
      assert.equal(variables[key], palette.foreground, key);
    }
    for (const key of ["primaryBorderColor", "clusterBorder", "actorBorder"]) {
      assert.equal(variables[key], palette.border, key);
    }
    for (let index = 0; index < 12; index++) {
      for (const key of [
        `pie${index + 1}`,
        `cScale${index}`,
        `cScaleLabel${index}`,
      ]) {
        assert.match(String(variables[key]), /^#[\da-f]{6}$/i, key);
      }
    }
    // Neutral editor inputs must never generate a rainbow default palette.
    for (let index = 0; index < 12; index++) {
      assert.match(
        String(variables[`pie${index + 1}`]),
        /^#([\da-f]{2})\1\1$/i,
      );
    }
  } finally {
    dom.window.close();
  }
});

test("cache identity separates palettes and trust without changing authored source", () => {
  const { dom, document } = themedDocument();
  try {
    const source =
      "flowchart LR\nA-->B\nclassDef red fill:#f00,stroke:#00f;\nclass A red;\nstyle B fill:#0f0;\nlinkStyle 0 stroke:#f80;";
    const light = readMermaidPalette(document);
    const key = mermaidCacheKey(source, false, light);
    assert.ok(key.endsWith(`|${source}`));
    assert.notEqual(key, mermaidCacheKey(source, true, light));
    document.body.style.setProperty("--vscode-editor-background", "#101010");
    assert.notEqual(
      key,
      mermaidCacheKey(source, false, readMermaidPalette(document)),
    );
  } finally {
    dom.window.close();
  }
});

test("theme observer refreshes changed palettes once and disconnects on disposal", async () => {
  const { dom, document } = themedDocument();
  let changes = 0;
  const stop = watchMermaidTheme(() => changes++, document);
  try {
    document.body.classList.add("unrelated");
    await Promise.resolve();
    assert.equal(changes, 0);
    document.body.style.setProperty("--vscode-editor-background", "#111111");
    document.body.className = "vscode-dark";
    await Promise.resolve();
    assert.equal(changes, 1);
    const style = document.createElement("style");
    style.textContent =
      "body { --vscode-editor-foreground: #ababab !important; }";
    document.head.append(style);
    await Promise.resolve();
    assert.equal(changes, 2);
    stop();
    document.body.className = "vscode-light";
    await Promise.resolve();
    assert.equal(changes, 2);
  } finally {
    stop();
    dom.window.close();
  }
});

test("renderer reinitializes on real host palette changes and preserves source and trust", async () => {
  const { default: mermaid } = await import("mermaid");
  const { dom, document } = themedDocument();
  const previousDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document",
  );
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: document,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: dom.window,
  });
  const initialize = mermaid.initialize;
  // Register real detectors before observing subsequent initialize calls.
  initialize({ securityLevel: "strict" });
  const render = mermaid.render;
  const configurations: Array<{
    theme?: string;
    securityLevel?: string;
    htmlLabels?: boolean;
    themeVariables?: Record<string, string>;
  }> = [];
  const sources: string[] = [];
  mermaid.initialize = ((configuration) =>
    configurations.push(configuration)) as typeof mermaid.initialize;
  mermaid.render = (async (_id: string, source: string) => {
    sources.push(source);
    return { svg: "<svg></svg>" };
  }) as unknown as typeof mermaid.render;
  let trusted = false;
  const renderer = new DiagramRenderer(
    { debug() {}, warn() {}, error() {} },
    {
      isTrusted: () => trusted,
      allow: () => {
        trusted = true;
      },
    },
    undefined,
    (svg) => svg,
  );
  try {
    const draw = (
      renderer as unknown as {
        renderMermaidSvg: (source: string) => Promise<string>;
      }
    ).renderMermaidSvg.bind(renderer);
    const source =
      "flowchart LR\nA-->B\nclassDef red fill:#f00;\nclass A red;\nstyle B fill:#0f0;\nlinkStyle 0 stroke:#00f;";
    await draw(source);
    await draw(source);
    assert.equal(configurations.length, 1);
    document.body.style.setProperty("--vscode-editor-background", "#111111");
    document.body.className = "vscode-dark";
    await draw(source);
    assert.equal(configurations.length, 2);
    assert.notEqual(
      configurations[0]?.themeVariables?.primaryColor,
      configurations[1]?.themeVariables?.primaryColor,
    );
    trusted = true;
    await draw(source);
    assert.equal(configurations.length, 3);
    for (const config of configurations) {
      assert.equal(config.theme, "base");
      assert.equal(config.securityLevel, "strict");
    }
    assert.deepEqual(
      configurations.map((config) => config.htmlLabels),
      [false, false, true],
    );
    assert.deepEqual(sources, Array(4).fill(source));
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

test("real Mermaid base derivation keeps nested chart defaults neutral and dark ER rows readable", async () => {
  const { default: mermaid } = await import("mermaid");
  const { dom, document } = themedDocument();
  try {
    document.body.className = "vscode-dark";
    document.body.style.cssText =
      "--vscode-editor-background:#121212;--vscode-editor-foreground:#ddd";
    const palette = readMermaidPalette(document);
    mermaid.initialize({
      theme: "base",
      themeVariables: mermaidThemeVariables(palette),
    });
    const variables = mermaid.mermaidAPI.getConfig().themeVariables;
    assert.equal(variables.attributeBackgroundColorOdd, palette.surface);
    assert.equal(variables.attributeBackgroundColorEven, palette.background);
    assert.equal(variables.sequenceNumberColor, palette.background);
    assert.equal(variables.cynefin.complexBg, palette.surface);
    assert.equal(variables.cynefin.cliffColor, palette.foreground);
    assert.equal(variables.wardley.evolutionStroke, palette.foreground);
    assert.equal(variables.radar.graticuleColor, palette.border);
    for (const color of String(variables.xyChart.plotColorPalette).split(",")) {
      assert.match(color, /^#([\da-f]{2})\1\1$/i);
    }
  } finally {
    dom.window.close();
  }
});

test("actual Mermaid parsing retains authored classDef, style and linkStyle hex colors", async () => {
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({
    theme: "base",
    securityLevel: "strict",
    htmlLabels: false,
    themeVariables: mermaidThemeVariables(readMermaidPalette()),
  });
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(
    "flowchart LR\nA-->B\nclassDef red fill:#f00,stroke:#00f\nclass A red\nstyle B fill:#0f0\nlinkStyle 0 stroke:#f80\n",
  );
  const db = diagram.db as unknown as {
    getClasses(): Map<string, { styles: string[] }>;
    getVertices(): Map<string, { styles: string[]; classes: string[] }>;
    getEdges(): Array<{ style: string[] }>;
  };
  assert.deepEqual(db.getClasses().get("red")?.styles, [
    "fill:#f00",
    "stroke:#00f",
  ]);
  assert.deepEqual(db.getVertices().get("A")?.classes, ["red"]);
  assert.deepEqual(db.getVertices().get("B")?.styles, ["fill:#0f0"]);
  assert.ok(db.getEdges()[0]?.style.includes("stroke:#f80"));
});
