import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { servePage } from "./page-server";
import type {} from "./fake-host";

/**
 * The browser suite measures gutter alignment and the editor's first frame.
 * Those measurements assume a known chrome, so the harness states it
 * explicitly rather than inheriting product defaults: issue #689 aligned three
 * defaults with Obsidian (centred page, inline title, hidden line numbers),
 * which the geometric specs do not draw. `useDefaults` opts back into the
 * shipped defaults for the specs that cover them.
 */
export const TEST_CHROME: Record<
  string,
  { enabled: boolean; config: Record<string, unknown> }
> = {
  inlineTitle: { enabled: false, config: {} },
  lineNumbers: { enabled: true, config: { style: "on" } },
};

export async function open(
  page: Page,
  source: string,
  preset: "minimal" | "obsidian" = "obsidian",
  {
    trusted = false,
    features = {},
    editor = {},
    useDefaults = false,
    videoDetails = {},
    notes = {},
    gitBaseline,
  }: {
    gitBaseline?: string;
    trusted?: boolean;
    features?: Record<
      string,
      { enabled: boolean; config: Record<string, unknown> }
    >;
    editor?: Record<string, unknown>;
    useDefaults?: boolean;
    videoDetails?: Record<string, Record<string, unknown>>;
    notes?: Record<string, string>;
  } = {},
) {
  await servePage(
    page,
    '<!doctype html><html><head><link rel="stylesheet" href="/dist/webview/editor.css"></head><body><main id="app" data-pdfium-wasm="/dist/webview/embedpdf.wasm"></main><script src="/artifacts/fake-host.js"></script></body></html>',
  );
  await page.evaluate(
    async ({
      source,
      preset,
      trusted,
      features,
      editor,
      useDefaults,
      testChrome,
      videoDetails,
      notes,
      gitBaseline,
    }) => {
      window.harness = new window.BrowserHost(source);
      window.harness.trusted = trusted;
      window.harness.features = useDefaults
        ? features
        : { ...testChrome, ...features };
      window.harness.editorSettings = useDefaults
        ? editor
        : { readableLineLength: false, ...editor };
      window.harness.videoDetails = videoDetails;
      window.harness.notes = notes;
      window.harness.gitBaseline = gitBaseline;
      await window.harness.open(preset);
    },
    {
      source,
      preset,
      trusted,
      features,
      editor,
      useDefaults,
      testChrome: TEST_CHROME,
      videoDetails,
      notes,
      gitBaseline,
    },
  );
  await expect(
    page.getByRole("textbox", { name: "Markdown content" }),
  ).toBeVisible();
}
