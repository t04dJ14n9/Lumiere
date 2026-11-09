import { test, expect, chromium } from "@playwright/test";
import type { Frame, Page } from "@playwright/test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { paths, readState } from "./state";
import {
  closeBrowser,
  docScreenshot,
  nativeTextEditor,
  openWorkbench,
  reopenWith,
  workbenchPage,
} from "./workbench";

async function editorFrame(page: Page): Promise<Frame> {
  for (const frame of page.frames()) {
    if (await frame.locator(".cm-line").count()) {
      return frame;
    }
  }
  throw new Error("No Lumiere frame");
}

for (const vim of [false, true]) {
  test(`typing [[ offers notes, and [[Note# offers its headings, Vim ${vim}`, async () => {
    const settingsFile = path.join(paths.userData, "User", "settings.json");
    const settings = readFileSync(settingsFile, "utf8");
    const note = path.join(paths.workspace, "Note.md");
    const target = path.join(paths.workspace, "Target Note.md");
    const original = readFileSync(note, "utf8");
    writeFileSync(
      settingsFile,
      JSON.stringify({
        ...(JSON.parse(settings) as object),
        "lumiere.markdown.plugins.vim.enabled": vim,
      }),
    );
    writeFileSync(note, "# Start\n\nText\n");
    writeFileSync(target, "# Target Note\n\n## Second Section\n\nBody\n");
    const browser = await chromium.connectOverCDP(readState().webSocket);
    try {
      const page = workbenchPage(browser);
      await openWorkbench(page);
      const frame = await editorFrame(page);
      await frame.locator(".cm-line", { hasText: "Text" }).click();
      if (vim) {
        await page.keyboard.type("o");
      } else {
        await page.keyboard.press("End");
        await page.keyboard.press("Enter");
      }
      await page.keyboard.type("[[", { delay: 50 });
      const popup = frame.locator(".cm-tooltip-autocomplete");
      await expect(popup).toBeVisible();
      await page.keyboard.type("Targ", { delay: 50 });
      await expect(popup).toContainText("Target Note");
      await page.keyboard.type("et Note#", { delay: 50 });
      await expect(popup).toContainText("Second Section");
    } finally {
      writeFileSync(settingsFile, settings);
      writeFileSync(note, original);
      rmSync(target, { force: true });
      await closeBrowser(browser);
    }
  });
}

test("typing [[ in VS Code's text editor offers notes and headings, and Enter writes the link", async () => {
  const note = path.join(paths.workspace, "Note.md");
  const target = path.join(paths.workspace, "Target Note.md");
  const original = readFileSync(note, "utf8");
  writeFileSync(note, "# Start\n\nText\n");
  writeFileSync(target, "# Target Note\n\n## Second Section\n\nBody\n");
  const browser = await chromium.connectOverCDP(readState().webSocket);
  try {
    const page = workbenchPage(browser);
    await openWorkbench(page);
    await reopenWith(page, "Text Editor");
    const editor = nativeTextEditor(page, "Text");
    const list = page.locator(".monaco-editor .suggest-widget");
    // A fresh editor can lose its first keys while it settles: start over
    // until the list opens. VS Code closes the brackets itself, `[[]]`.
    await expect(async () => {
      await editor.locator(".view-lines").click();
      await page.keyboard.press("Escape");
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.press("Backspace");
      await page.keyboard.type("[[", { delay: 100 });
      await expect(list).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 30000 });
    await page.keyboard.type("Targ", { delay: 50 });
    await expect(list).toContainText("Target Note");
    await page.keyboard.type("et Note#", { delay: 50 });
    await expect(list).toContainText("Second Section");
    await page.screenshot({
      path: docScreenshot("text-editor-link-suggest.png"),
    });
    // The headings come in document order: narrow them down to the second.
    await page.keyboard.type("Sec", { delay: 50 });
    await expect(list.locator(".monaco-list-row")).toHaveCount(1);
    await page.keyboard.press("Enter");
    await expect(list).toBeHidden();
    await page.keyboard.press("ControlOrMeta+s");
    await expect
      .poll(() => readFileSync(note, "utf8"))
      .toBe("[[Target Note#Second Section]]");
  } finally {
    writeFileSync(note, original);
    rmSync(target, { force: true });
    await closeBrowser(browser);
  }
});
