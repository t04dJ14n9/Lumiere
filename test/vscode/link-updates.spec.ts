import { test, expect, chromium } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const folderFile = inWorkspace(path.join(".vscode", "settings.json"));
const MODE = "lumiere.markdown.linkUpdates.mode";

/** A settings file's value for the link update mode, if the file has one. */
function modeIn(file: string): unknown {
  if (!existsSync(file)) {
    return undefined;
  }
  return (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>)[
    MODE
  ];
}

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
  // stays open with nothing renamed. On macOS the context menu can be the
  // system's, outside the page, so after a right-click shows no Rename item
  // the row is selected and renamed with the key VS Code binds there (Enter
  // on macOS, F2 elsewhere). Try again until the box is there.
  await expect(async () => {
    if (!(await input.isVisible())) {
      if (!(await rename.isVisible())) {
        // A left click would open the file and move the focus into its editor.
        await row.click({ button: "right" });
      }
      const isMenuShown = await rename
        .waitFor({ state: "visible", timeout: 1_000 })
        .then(
          () => true,
          () => false,
        );
      if (isMenuShown) {
        await rename.click({ timeout: 2_000 });
      } else {
        await page.keyboard.press("Escape");
        // The row's path tooltip, shown while the pointer rests on it, takes
        // the click: move away until it closes.
        await page.mouse.move(0, 0);
        await page
          .locator(".context-view .hover-contents")
          .waitFor({ state: "hidden", timeout: 2_000 })
          .catch(() => {});
        await row.click({ position: { x: 4, y: 4 } });
        // The click opens the file, and its editor (a webview) can take the
        // focus: Enter there would type a line break into the note. Give the
        // focus back to the Explorer's list, whose focused row is the one
        // clicked, and press the key only when the Explorer has it.
        await page
          .locator(".explorer-folders-view .monaco-list")
          .first()
          .focus();
        const isExplorerFocused = await page.evaluate(() =>
          Boolean(document.activeElement?.closest(".explorer-folders-view")),
        );
        if (isExplorerFocused) {
          await page.keyboard.press(
            process.platform === "darwin" ? "Enter" : "F2",
          );
        }
      }
    }
    await expect(input).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(to);
  await page.keyboard.press("Enter");
}

/** A canvas with one file node, as Obsidian writes it. */
function board(file: string): string {
  return JSON.stringify(
    { nodes: [{ id: "n", type: "file", file, x: 0, y: 0 }], edges: [] },
    null,
    "\t",
  );
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

test("Always Update in the rename dialog updates the links, saves the mode for the workspace folder, and the next rename does not ask", async () => {
  const originalUserSettings = readFileSync(userFile, "utf8");
  const settings = JSON.parse(originalUserSettings) as Record<string, unknown>;
  // The unset contribution default is prompt, as in Obsidian when
  // alwaysUpdateLinks is false. Fail clearly if setup already pinned the key.
  if ("lumiere.markdown.linkUpdates.mode" in settings) {
    throw new Error(
      "lumiere.markdown.linkUpdates.mode is already set in User/settings.json; this spec tests the unset contribution default and must run without that key.",
    );
  }
  const originalFolderSettings = existsSync(folderFile)
    ? readFileSync(folderFile, "utf8")
    : undefined;
  if (modeIn(folderFile) !== undefined) {
    throw new Error(`${MODE} is already set in ${folderFile}.`);
  }
  let browser: Browser | undefined;
  try {
    writeFileSync(inWorkspace("Rename Target.md"), "# Target\n");
    writeFileSync(
      inWorkspace("Rename Linker.md"),
      "---\nup: '[[Rename Target]]'\n---\nSee [[Rename Target]].\n",
    );
    writeFileSync(
      inWorkspace("Rename Board.canvas"),
      board("Rename Target.md"),
    );
    browser = await chromium.connectOverCDP(readState().webSocket);
    const page = workbenchPage(browser);
    // Opening a note activates the extension, as it is for any real session.
    await openWorkbench(page);
    await closeEditorGroups(page);
    await command(page, "View: Show Explorer");
    const dialog = page.locator(".monaco-dialog-box");

    await renameInExplorer(page, "Rename Target.md", "Rename Goal.md");
    await expect(dialog).toContainText("Update links in 2 files?");
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
      .toBe("---\nup: '[[Rename Goal]]'\n---\nSee [[Rename Goal]].\n");
    await expect
      .poll(() => readFileSync(inWorkspace("Rename Board.canvas"), "utf8"))
      .toBe(board("Rename Goal.md"));
    // Always Update writes always to the workspace folder's settings, as
    // Obsidian keeps alwaysUpdateLinks per vault; the user's stay unset.
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
      .toBe("---\nup: '[[Rename Target]]'\n---\nSee [[Rename Target]].\n");
    await expect
      .poll(() => readFileSync(inWorkspace("Rename Board.canvas"), "utf8"))
      .toBe(board("Rename Target.md"));
  } finally {
    try {
      if (browser) {
        await closeBrowser(browser);
      }
    } finally {
      writeFileSync(userFile, originalUserSettings);
      if (originalFolderSettings === undefined) {
        rmSync(folderFile, { force: true });
      } else {
        writeFileSync(folderFile, originalFolderSettings);
      }
      rmSync(inWorkspace("Rename Target.md"), { force: true });
      rmSync(inWorkspace("Rename Goal.md"), { force: true });
      rmSync(inWorkspace("Rename Linker.md"), { force: true });
      rmSync(inWorkspace("Rename Board.canvas"), { force: true });
    }
  }
});
