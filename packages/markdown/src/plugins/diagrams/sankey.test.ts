import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import type { MermaidConfig } from "mermaid";
import { DiagramRenderer } from "./renderer";
import { readMermaidPalette } from "./theme";

interface SankeyFixture {
  draw: (source: string) => Promise<string>;
  prepare: (source: string) => { key: string; render: () => Promise<string> };
  configurations: MermaidConfig[];
  document: Document;
  setTrusted: (value: boolean) => void;
  failRender: () => void;
}

async function withSankeyFixture(
  run: (fixture: SankeyFixture) => Promise<void>,
) {
  const dom = new JSDOM("");
  const document = dom.window.document as unknown as Document;
  document.body.className = "vscode-light";
  document.body.style.cssText =
    "--vscode-editor-background:#fafafa;--vscode-editor-foreground:#141414";
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
  const { default: mermaid } = await import("mermaid");
  const originalRender = mermaid.render;
  const configurations: MermaidConfig[] = [];
  let failing = false;
  // Keep the actual Mermaid parser/directive/config machinery; no options-only fake.
  mermaid.render = (async (_id: string, source: string) => {
    await mermaid.parse(source);
    configurations.push(mermaid.mermaidAPI.getConfig());
    if (failing) {
      throw new Error("render failed");
    }
    return { svg: "<svg></svg>" };
  }) as typeof mermaid.render;
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
  const draw = (
    renderer as unknown as {
      renderMermaidSvg: (source: string) => Promise<string>;
    }
  ).renderMermaidSvg.bind(renderer);
  try {
    await run({
      draw,
      prepare: (source) =>
        (
          renderer as unknown as { prepareMermaid: SankeyFixture["prepare"] }
        ).prepareMermaid(source),
      configurations,
      document,
      setTrusted: (value) => {
        trusted = value;
      },
      failRender: () => {
        failing = true;
      },
    });
  } finally {
    renderer.dispose();
    mermaid.render = originalRender;
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
}

test("Sankey normalized CSV node IDs receive editor defaults through real Mermaid config", async () => {
  await withSankeyFixture(async ({ draw, configurations, document }) => {
    await draw('sankey-beta\n"Source, quoted","Target",2\n');
    const palette = readMermaidPalette(document);
    assert.equal(
      configurations[0]?.sankey?.nodeColors?.["Source, quoted"],
      palette.border,
    );
    assert.equal(configurations[0]?.sankey?.nodeColors?.Target, palette.border);
    const { default: mermaid } = await import("mermaid");
    assert.deepEqual(
      mermaid.mermaidAPI.getSiteConfig().sankey?.nodeColors ?? {},
      {},
    );
  });
});

test("Sankey frontmatter and init colors win across host theme and trust changes", async () => {
  await withSankeyFixture(
    async ({ draw, configurations, document, setTrusted }) => {
      const source =
        "---\nconfig:\n  securityLevel: loose\n  sankey:\n    nodeColors:\n      Source: '#ff0000'\n    linkColor: '#00ff00'\n---\nsankey-beta\nSource,Target,2\n";
      await draw(source);
      const light = readMermaidPalette(document);
      document.body.className = "vscode-dark";
      document.body.style.cssText =
        "--vscode-editor-background:#121212;--vscode-editor-foreground:#dddddd";
      setTrusted(true);
      await draw(source);
      const dark = readMermaidPalette(document);
      assert.notEqual(light.border, dark.border);
      assert.equal(configurations[0]?.sankey?.nodeColors?.Target, light.border);
      assert.equal(configurations[1]?.sankey?.nodeColors?.Target, dark.border);
      for (const config of configurations) {
        assert.equal(config.sankey?.nodeColors?.Source, "#ff0000");
        assert.equal(config.sankey?.linkColor, "#00ff00");
        assert.equal(config.securityLevel, "strict");
      }
      assert.deepEqual(
        configurations.map((config) => config.htmlLabels),
        [false, true],
      );
      await draw(
        '%%{init: {"sankey": {"nodeColors": {"Target": "#abcdef"}}}}%%\nsankey-beta\nSource,Target,2\n',
      );
      assert.equal(configurations[2]?.sankey?.nodeColors?.Target, "#abcdef");
      assert.equal(configurations[2]?.sankey?.nodeColors?.Source, dark.border);
      await draw("sankey-beta\nOther,Last,1\n");
      assert.deepEqual(configurations[3]?.sankey?.nodeColors, {
        Other: dark.border,
        Last: dark.border,
      });
    },
  );
});

test("Sankey default configuration is restored after a failed render", async () => {
  await withSankeyFixture(
    async ({ draw, configurations, document, failRender }) => {
      failRender();
      await assert.rejects(
        draw("sankey-beta\nSource,Target,2\n"),
        /render failed/,
      );
      assert.equal(
        configurations[0]?.sankey?.nodeColors?.Source,
        readMermaidPalette(document).border,
      );
      const { default: mermaid } = await import("mermaid");
      assert.deepEqual(
        mermaid.mermaidAPI.getSiteConfig().sankey?.nodeColors ?? {},
        {},
      );
      assert.equal(mermaid.mermaidAPI.getConfig().securityLevel, "strict");
    },
  );
});

test("Sankey defaults follow high contrast without replacing authored colors", async () => {
  await withSankeyFixture(async ({ draw, configurations, document }) => {
    document.body.className = "vscode-high-contrast";
    document.body.style.cssText =
      "--vscode-editor-background:#000000;--vscode-editor-foreground:#ffffff;--vscode-contrastBorder:#ffff00";
    await draw(
      "---\nconfig:\n  sankey:\n    nodeColors:\n      Source: '#ff0000'\n---\nsankey-beta\nSource,Target,2\n",
    );
    assert.equal(configurations[0]?.sankey?.nodeColors?.Source, "#ff0000");
    assert.equal(configurations[0]?.sankey?.nodeColors?.Target, "#ffff00");
  });
});

test("a Sankey parse failure restores strict baseline configuration", async () => {
  await withSankeyFixture(async ({ draw }) => {
    await assert.rejects(
      draw("sankey-beta\nSource,Target,not-a-number,extra\n"),
    );
    const { default: mermaid } = await import("mermaid");
    assert.deepEqual(
      mermaid.mermaidAPI.getSiteConfig().sankey?.nodeColors ?? {},
      {},
    );
    assert.equal(mermaid.mermaidAPI.getConfig().securityLevel, "strict");
  });
});

test("prepared Sankey cache identities keep captured theme and trust across deferred execution", async () => {
  await withSankeyFixture(
    async ({ prepare, configurations, document, setTrusted }) => {
      const source = "sankey-beta\nSource,Target,2\n";
      const light = readMermaidPalette(document);
      const pendingLight = prepare(source);
      document.body.className = "vscode-dark";
      document.body.style.cssText =
        "--vscode-editor-background:#121212;--vscode-editor-foreground:#dddddd";
      setTrusted(true);
      const dark = readMermaidPalette(document);
      const pendingDark = prepare(source);
      assert.notEqual(pendingLight.key, pendingDark.key);
      await pendingLight.render();
      await pendingDark.render();
      assert.equal(configurations[0]?.sankey?.nodeColors?.Source, light.border);
      assert.equal(configurations[1]?.sankey?.nodeColors?.Source, dark.border);
      assert.deepEqual(
        configurations.map((config) => config.htmlLabels),
        [false, true],
      );
    },
  );
});
