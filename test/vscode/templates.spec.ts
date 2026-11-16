import { test, expect, chromium } from "@playwright/test";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { paths, readState } from "./state";
import {
  QUICK_INPUT,
  closeBrowser,
  closeEditorGroups,
  command,
  docScreenshot,
  openWorkbench,
  workbenchPage,
} from "./workbench";

const folderSettings = path.join(paths.workspace, ".vscode", "settings.json");
const templates = path.join(paths.workspace, "Templates");
const target = path.join(paths.workspace, "TemplateTarget.md");

/** Local date as `YYYY-MM-DD`, which `{{date}}` uses by default. */
function today(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

let savedSettings: string | undefined;

test.beforeAll(() => {
  savedSettings = existsSync(folderSettings)
    ? readFileSync(folderSettings, "utf8")
    : undefined;
  mkdirSync(templates, { recursive: true });
  writeFileSync(
    path.join(templates, "Inline.md"),
    "{{title}} on {{date:YYYY-MM-DD}}",
  );
  mkdirSync(path.dirname(folderSettings), { recursive: true });
  writeFileSync(
    folderSettings,
    JSON.stringify({ "lumiere.markdown.templates.folder": "Templates" }),
  );
});

test.afterAll(() => {
  for (const leftover of [templates, target]) {
    rmSync(leftover, { recursive: true, force: true });
  }
  if (savedSettings === undefined) {
    rmSync(folderSettings, { force: true });
  } else {
    writeFileSync(folderSettings, savedSettings);
  }
});

// Templates is a deferred window feature: it starts on the first Lumiere
// panel's editor/ready. Reloading first gives a window where no panel has
// existed yet, however many notes earlier specs opened, so the note opened
// here is the one that must start it.
test("Insert Template, in a fresh window, replaces the selection and leaves the caret after the text", async () => {
  writeFileSync(target, "alpha beta gamma");
  const browser = await chromium.connectOverCDP(readState().webSocket);
  try {
    let page = workbenchPage(browser);
    await closeEditorGroups(page);
    await command(page, "Developer: Reload Window");
    await page.waitForTimeout(1000);
    page = workbenchPage(browser);
    await expect(page.locator(".monaco-workbench")).toBeVisible({
      timeout: 60000,
    });
    await expect(page.locator(".tabs-container .tab")).toHaveCount(0);

    const editor = await openWorkbench(page, "TemplateTarget.md");
    await editor.click();
    // Select "beta".
    await page.keyboard.press("Home");
    for (let step = 0; step < "alpha ".length; step += 1) {
      await page.keyboard.press("ArrowRight");
    }
    for (let step = 0; step < "beta".length; step += 1) {
      await page.keyboard.press("Shift+ArrowRight");
    }

    await command(page, "Lumiere: Insert Template");
    await page.locator(QUICK_INPUT).fill("Inline");
    await expect(
      page
        .locator(".quick-input-list .monaco-list-row")
        .filter({ hasText: "Inline" })
        .first(),
    ).toBeVisible();
    await page.keyboard.press("Enter");

    const inserted = `TemplateTarget on ${today()}`;
    await expect(editor).toContainText(`alpha ${inserted} gamma`);
    // Typing goes where the caret was put: right after the inserted text.
    await page.keyboard.insertText("!");
    await page.keyboard.press("ControlOrMeta+s");
    await expect
      .poll(() => readFileSync(target, "utf8"))
      .toBe(`alpha ${inserted}! gamma`);
    await page.screenshot({ path: docScreenshot("insert-template.png") });
  } finally {
    await closeBrowser(browser);
  }
});
