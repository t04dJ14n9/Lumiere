import { test, expect } from "@playwright/test";
import { servePage } from "./page-server";
import type {} from "./fake-host";

/**
 * At the Properties chrome mark, the line-number gutter must already be in
 * the DOM — not waiting on the later paint phase — so open does not flash a
 * missing gutter then inject it.
 */
test("mw:properties frame already has Properties sheet and lineNumbers gutter", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await servePage(
    page,
    '<!doctype html><html><head><link rel="stylesheet" href="/dist/webview/editor.css"></head><body><main id="app"></main><script src="/artifacts/fake-host.js"></script></body></html>',
  );
  const atProperties = await page.evaluate(async () => {
    window.harness = new window.BrowserHost(
      "---\ntitle: hi\nstatus: open\n---\n\n# Heading\n\nbody\n",
    );
    window.harness.trusted = false;
    window.harness.features = {};
    window.harness.notes = {};
    const opening = window.harness.open("obsidian");
    const mark = (name: string) =>
      performance.getEntriesByName(name)[0]?.startTime;
    while (mark("mw:properties") === undefined) {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    }
    // One more frame so chrome configure's DOM commit is visible.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    const snapshot = {
      lineNumbers: document.querySelector(".cm-lineNumbers") !== null,
      properties: document.querySelector(".metadata-container") !== null,
      featuresReady: mark("mw:features") !== undefined,
    };
    await opening;
    return snapshot;
  });
  expect(atProperties.properties).toBe(true);
  expect(atProperties.lineNumbers).toBe(true);
});
