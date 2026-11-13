import { test, expect, chromium } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
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
  closeBrowser,
  closeEditorGroups,
  command,
  docScreenshot,
  openWorkbench,
  workbenchPage,
} from "./workbench";

const userFile = path.join(paths.userData, "User", "settings.json");
const folderFile = path.join(paths.workspace, ".vscode", "settings.json");
const inWorkspace = (name: string) => path.join(paths.workspace, name);

/** Renames a file from the Explorer, as a user does: Rename in its menu, type, Enter. */
async function renameInExplorer(page: Page, from: string, to: string) {
  const row = page
    .locator(".explorer-folders-view .monaco-list-row")
    .filter({ hasText: from })
    .first();
  // The Explorer lists a file written by the spec once the watcher reports it.
  await expect(row).toBeVisible({ timeout: 20_000 });
  // A click would open the file and move the focus into its editor.
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: /^Rename/ }).click();
  const input = page.locator(".explorer-folders-view .monaco-inputbox input");
  await expect(input).toBeVisible();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(to);
  await page.keyboard.press("Enter");
}

/**
 * VS Code's own prompt for edits an extension makes with a file move; it
 * follows Lumiere's question and is not Lumiere's.
 */
async function acceptRefactoring(page: Page) {
  const prompt = page
    .locator(".monaco-dialog-box")
    .filter({ hasText: "refactoring changes" });
  await expect(prompt).toBeVisible();
  await prompt.getByRole("button", { name: "OK" }).click();
}

test("Always Update in the rename dialog updates the links, saves the mode for the folder, and the next rename does not ask", async () => {
  const originalUserSettings = readFileSync(userFile, "utf8");
  // The folder's settings file stays in place and is only rewritten: VS Code's
  // watcher follows edits to it, but can miss one deleted and created again.
  const originalFolderSettings = existsSync(folderFile)
    ? readFileSync(folderFile, "utf8")
    : undefined;
  const settings = JSON.parse(originalUserSettings) as Record<string, unknown>;
  // The unset contribution default is prompt, as in Obsidian when
  // alwaysUpdateLinks is false. Fail clearly if setup already pinned the key.
  if ("lumiere.markdown.linkUpdates.mode" in settings) {
    throw new Error(
      "lumiere.markdown.linkUpdates.mode is already set in User/settings.json; this spec tests the unset contribution default and must run without that key.",
    );
  }
  let browser: Browser | undefined;
  try {
    mkdirSync(path.dirname(folderFile), { recursive: true });
    writeFileSync(folderFile, "{}");
    writeFileSync(inWorkspace("Rename Target.md"), "# Target\n");
    writeFileSync(inWorkspace("Rename Linker.md"), "See [[Rename Target]].\n");
    browser = await chromium.connectOverCDP(readState().webSocket);
    const page = workbenchPage(browser);
    // Opening a note activates the extension, as it is for any real session.
    await openWorkbench(page);
    await closeEditorGroups(page);
    await command(page, "View: Show Explorer");
    const dialog = page.locator(".monaco-dialog-box");

    await renameInExplorer(page, "Rename Target.md", "Rename Goal.md");
    await expect(dialog).toContainText("Update links in 1 file?");
    for (const button of ["Update Links", "Always Update", "Don't Update"]) {
      await expect(dialog.getByRole("button", { name: button })).toBeVisible();
    }
    await page.screenshot({ path: docScreenshot("link-updates-dialog.png") });
    await dialog.getByRole("button", { name: "Always Update" }).click();
    await acceptRefactoring(page);
    await expect
      .poll(() => readFileSync(inWorkspace("Rename Linker.md"), "utf8"), {
        timeout: 20_000,
      })
      .toBe("See [[Rename Goal]].\n");
    // Always Update is about this folder's notes: it writes the workspace
    // folder's settings, and the user's settings, which started unset, stay so.
    const modeIn = (file: string) =>
      (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>)[
        "lumiere.markdown.linkUpdates.mode"
      ];
    await expect.poll(() => modeIn(folderFile)).toBe("always");
    expect(modeIn(userFile)).toBeUndefined();

    // VS Code's prompt is the first dialog this rename shows: Lumiere did not ask.
    await renameInExplorer(page, "Rename Goal.md", "Rename Target.md");
    await acceptRefactoring(page);
    await expect(dialog.filter({ hasText: "Update links in" })).toHaveCount(0);
    await expect
      .poll(() => readFileSync(inWorkspace("Rename Linker.md"), "utf8"), {
        timeout: 20_000,
      })
      .toBe("See [[Rename Target]].\n");
  } finally {
    try {
      if (browser) {
        await closeBrowser(browser);
      }
    } finally {
      writeFileSync(userFile, originalUserSettings);
      writeFileSync(folderFile, originalFolderSettings ?? "{}");
      rmSync(inWorkspace("Rename Target.md"), { force: true });
      rmSync(inWorkspace("Rename Goal.md"), { force: true });
      rmSync(inWorkspace("Rename Linker.md"), { force: true });
    }
  }
});
