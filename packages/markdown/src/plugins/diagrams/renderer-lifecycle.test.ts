import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { JSDOM } from "jsdom";
import type { MermaidConfig } from "mermaid";
import { DiagramRenderer } from "./renderer";
import { readMermaidPalette } from "./theme";

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function drawing(renderer: DiagramRenderer) {
  return (
    renderer as unknown as {
      renderMermaidSvg: (source: string) => Promise<string>;
    }
  ).renderMermaidSvg.bind(renderer);
}

for (const failingOld of [false, true]) {
  test(
    `disposed Sankey cannot overwrite replacement theme/cache configuration (${failingOld ? "failure" : "success"})`,
    { timeout: 10_000 },
    async () => {
      const dom = new JSDOM("");
      const document = dom.window.document as unknown as Document;
      document.body.className = "vscode-light";
      document.body.style.cssText =
        "--vscode-editor-background:#fafafa;--vscode-editor-foreground:#141414";
      const previousDocument = Object.getOwnPropertyDescriptor(
        globalThis,
        "document",
      );
      const previousWindow = Object.getOwnPropertyDescriptor(
        globalThis,
        "window",
      );
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: document,
      });
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: dom.window,
      });
      const { default: mermaid } = await import("mermaid");
      const initialize = mermaid.initialize;
      const render = mermaid.render;
      const entered = deferred();
      const release = deferred();
      const initializations: MermaidConfig[] = [];
      const captures: Array<{ source: string; config: MermaidConfig }> = [];
      let first = true;
      mermaid.initialize = (config) => {
        initializations.push(config);
        initialize(config);
      };
      // Only the geometry-dependent final SVG draw is intercepted. Actual
      // Mermaid parsing/directive normalization supplies the effective config.
      mermaid.render = (async (_id, source) => {
        await mermaid.parse(source);
        captures.push({ source, config: mermaid.mermaidAPI.getConfig() });
        if (first) {
          first = false;
          entered.resolve();
          await release.promise;
          if (failingOld) {
            throw new Error("old render failed");
          }
        }
        return { svg: "<svg></svg>", diagramType: mermaid.detectType(source) };
      }) as typeof render;
      const logger = { debug() {}, warn() {}, error() {} };
      const old = new DiagramRenderer(
        logger,
        { isTrusted: () => false, allow() {} },
        undefined,
        (svg) => svg,
      );
      let replacement: DiagramRenderer | undefined;
      const oldResult = drawing(old)("sankey-beta\nOld,Target,1\n").then(
        () => "success",
        () => "failure",
      );
      let replacementResult: Promise<string> | undefined;
      try {
        await entered.promise;
        old.dispose();
        document.body.className = "vscode-dark";
        document.body.style.cssText =
          "--vscode-editor-background:#121212;--vscode-editor-foreground:#dddddd";
        const palette = readMermaidPalette(document);
        replacement = new DiagramRenderer(
          logger,
          { isTrusted: () => true, allow() {} },
          undefined,
          (svg) => svg,
        );
        replacementResult = drawing(replacement)("flowchart LR\nA-->B\n");
        await setImmediate();
        const overlapped = initializations.some(
          (config) => config.themeVariables.primaryColor === palette.surface,
        );
        release.resolve();
        assert.equal(await oldResult, failingOld ? "failure" : "success");
        await replacementResult;
        const source =
          "---\nconfig:\n  sankey:\n    nodeColors:\n      Source: '#ff0000'\n---\nsankey-beta\nSource,NewTarget,2\n";
        const prepare = (
          replacement as unknown as {
            prepareMermaid: (source: string) => {
              key: string;
              render: () => Promise<string>;
            };
          }
        ).prepareMermaid(source);
        assert.ok(prepare.key.includes(palette.surface));
        await prepare.render();
        const last = captures.at(-1)?.config;
        assert.equal(
          last?.themeVariables.primaryColor,
          palette.surface,
          "replacement cache key and effective Mermaid theme must agree",
        );
        assert.equal(last?.htmlLabels, true);
        assert.equal(last?.securityLevel, "strict");
        assert.equal(last?.sankey?.nodeColors?.Source, "#ff0000");
        assert.equal(last?.sankey?.nodeColors?.NewTarget, palette.border);
        assert.equal(
          overlapped,
          false,
          "replacement must wait for the old complete global transaction",
        );
        assert.deepEqual(
          mermaid.mermaidAPI.getSiteConfig().sankey?.nodeColors ?? {},
          {},
        );
      } finally {
        release.resolve();
        await oldResult;
        await replacementResult?.catch(() => {});
        old.dispose();
        replacement?.dispose();
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
    },
  );
}
