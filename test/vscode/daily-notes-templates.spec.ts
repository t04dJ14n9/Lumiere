import { test, expect, chromium } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
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
const journal = path.join(paths.workspace, "Journal");
const target = path.join(paths.workspace, "TemplateTarget.md");

/** Local date as `YYYY-MM-DD`, which the daily note and `{{date}}` both use. */
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
    path.join(templates, "Daily.md"),
    "# {{title}}\n\nOpened on {{date:YYYY}}\n",
  );
  writeFileSync(
    path.join(templates, "Inline.md"),
    "{{title}} on {{date:YYYY-MM-DD}}",
  );
  mkdirSync(path.dirname(folderSettings), { recursive: true });
  writeFileSync(
    folderSettings,
    JSON.stringify({
      "lumiere.markdown.dailyNotes.folder": "Journal",
      "lumiere.markdown.dailyNotes.template": "Templates/Daily",
      "lumiere.markdown.templates.folder": "Templates",
    }),
  );
});

test.afterAll(() => {
  for (const leftover of [templates, journal, target]) {
    rmSync(leftover, { recursive: true, force: true });
  }
  if (savedSettings === undefined) {
    rmSync(folderSettings, { force: true });
  } else {
    writeFileSync(folderSettings, savedSettings);
  }
});

/** The Markdown editor of whichever Lumia webview is showing. */
async function lumiaEditor(page: Page): Promise<Locator> {
  let found: Locator | undefined;
  await expect
    .poll(
      async () => {
        for (const frame of page.frames()) {
          const editor = frame.getByRole("textbox", {
            name: "Markdown content",
          });
          if (await editor.count()) {
            found = editor;
            return true;
          }
        }
        return false;
      },
      { timeout: 15000 },
    )
    .toBe(true);
  return found!;
}

// Lumia starts the commands of a window when VS Code activates the extension;
// the daily notes ones used to wait for the first Lumia panel, so in a window
// where no note had been opened yet VS Code reported them as not found.
test("Open Today's Daily Note creates and opens the note before any Lumia editor exists", async () => {
  const browser = await chromium.connectOverCDP(readState().webSocket);
  try {
    let page = workbenchPage(browser);
    // Nothing open, then reload: the extension starts again in this window
    // with no panel, however many notes earlier specs opened.
    await closeEditorGroups(page);
    await command(page, "Developer: Reload Window");
    await page.waitForTimeout(1000);
    page = workbenchPage(browser);
    await expect(page.locator(".monaco-workbench")).toBeVisible({
      timeout: 60000,
    });
    await expect(page.locator(".tabs-container .tab")).toHaveCount(0);

    const note = path.join(journal, `${today()}.md`);
    expect(existsSync(note)).toBe(false);
    await command(page, "Lumia: Open Today's Daily Note");

    await expect.poll(() => existsSync(note), { timeout: 20000 }).toBe(true);
    expect(readFileSync(note, "utf8")).toBe(
      `# ${today()}\n\nOpened on ${today().slice(0, 4)}\n`,
    );
    await expect(
      page.locator(".tabs-container .tab").filter({ hasText: `${today()}.md` }),
    ).toBeVisible({ timeout: 20000 });
    const editor = await lumiaEditor(page);
    await expect(editor).toContainText(`Opened on ${today().slice(0, 4)}`);
    await expect(
      page.locator(".notifications-toasts .notification-list-item"),
    ).toHaveCount(0);
    await page.screenshot({
      path: docScreenshot("daily-notes-open-today.png"),
    });

    // The second run opens the note that is there and leaves it as it is.
    await command(page, "Lumia: Open Today's Daily Note");
    await page.waitForTimeout(1000);
    expect(readFileSync(note, "utf8")).toBe(
      `# ${today()}\n\nOpened on ${today().slice(0, 4)}\n`,
    );
  } finally {
    await closeBrowser(browser);
  }
});

test("Insert Template replaces the selection and leaves the caret after the text", async () => {
  writeFileSync(target, "alpha beta gamma");
  const browser = await chromium.connectOverCDP(readState().webSocket);
  try {
    const page = workbenchPage(browser);
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

    await command(page, "Lumia: Insert Template");
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
