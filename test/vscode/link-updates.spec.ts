import { test, expect, chromium } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
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
const inWorkspace = (name: string) => path.join(paths.workspace, name);

/** Renames a file from the Explorer, as a user does: Rename in its menu, type, Enter. */
async function renameInExplorer(page: Page, from: string, to: string) {
  const row = page
    .locator(".explorer-folders-view .monaco-list-row")
    .filter({ hasText: from })
    .first();
  // The Explorer lists a file written by the spec once the watcher reports it.
  await expect(row).toBeVisible({ timeout: 20_000 });
  const rename = page.getByRole("menuitem", { name: /^Rename/ });
  const input = page.locator(".explorer-folders-view .monaco-inputbox input");
  // VS Code's own menu on Linux can drop a click made just as it opens: it
  // stays open with nothing renamed. Click again until the box is there.
  await expect(async () => {
    if (!(await input.isVisible())) {
      if (!(await rename.isVisible())) {
        // A click would open the file and move the focus into its editor.
        await row.click({ button: "right" });
      }
      await rename.click({ timeout: 2_000 });
    }
    await expect(input).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
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

test("Always Update in the rename dialog updates the links, saves the mode, and the next rename does not ask", async () => {
  const originalUserSettings = readFileSync(userFile, "utf8");
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
    // Always Update writes always to the user's settings, which started unset.
    await expect
      .poll(
        () =>
          (
            JSON.parse(readFileSync(userFile, "utf8")) as Record<
              string,
              unknown
            >
          )["lumiere.markdown.linkUpdates.mode"],
      )
      .toBe("always");

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
      rmSync(inWorkspace("Rename Target.md"), { force: true });
      rmSync(inWorkspace("Rename Goal.md"), { force: true });
      rmSync(inWorkspace("Rename Linker.md"), { force: true });
    }
  }
});
