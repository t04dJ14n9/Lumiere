/**
 * Host GUI BH-007: selecting a `|200` image must not leave a tall caret /
 * empty shell band below the card. The paint reserve (estimatedHeight) is
 * released after measure, and the caret is hidden while the image is selected.
 */
import { expect, test, type Locator } from "@playwright/test";
import { open } from "./harness";

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAIAAAADnC86AAAALUlEQVR4nO3NMQkAAAwDsPo3vSkolED+5JKKzioWi8VisVgsFovFYrFYLB6NH6r1OhvW1o1iAAAAAElFTkSuQmCC";

test("selected |200 image has no caret bar below the card", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await open(
    page,
    `# Embeds\n\nAn image by wikilink, with a width:\n\n![Fixture|200](${PNG})\n\nafter\n`,
  );
  const img = page.locator("img.note-image").first();
  await expect(img).toBeVisible({ timeout: 10000 });
  // Allow load → measure → minHeight release.
  await expect
    .poll(async () =>
      img.evaluate((el) => {
        const shell = el.closest(".hybrid-block") as HTMLElement | null;
        return shell?.style.minHeight ?? "";
      }),
    )
    .toBe("");
  await img.click();
  await expect(img).toHaveClass(/md-image-selected/);
  const info = await page.evaluate(() => {
    const image = document.querySelector("img.note-image")!;
    const shell = image.closest(".hybrid-block") as HTMLElement;
    const editor = document.querySelector(".cm-editor") as HTMLElement;
    const caret = document.querySelector(".mw-caret") as HTMLElement | null;
    const imgBox = image.getBoundingClientRect();
    const shellBox = shell.getBoundingClientRect();
    const style = caret
      ? getComputedStyle(caret.closest(".mw-caret-layer")!).visibility
      : "missing";
    return {
      selectedAttr: editor.hasAttribute("data-mw-image-selected"),
      minHeight: shell.style.minHeight,
      imgH: imgBox.height,
      shellH: shellBox.height,
      caretVisible: style,
    };
  });
  expect(info.selectedAttr).toBe(true);
  expect(info.minHeight).toBe("");
  // Shell no longer keeps the |W| estimatedHeight reserve under the card.
  expect(info.shellH).toBeLessThanOrEqual(info.imgH + 8);
  // Caret layer hidden while selected (geometry may still exist).
  expect(info.caretVisible).toBe("hidden");
});

test("images (standalone and inside tables) and Mermaid diagrams open in larger window only from their Inspect button", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 750 });
  const doc = [
    "# Media Lightbox",
    "",
    `![Standalone|160](${PNG})`,
    "",
    `- List item with inline image ![InlineImage](${PNG})`,
    "",
    "| Col A | Col B |",
    "| --- | --- |",
    `| cell | ![TableImage](${PNG}) |`,
    "",
    "```mermaid",
    "flowchart LR",
    "  A[Start] --> B[End]",
    "```",
    "",
    "Tail paragraph",
  ].join("\n");
  await open(page, doc);

  const dialog = page.locator("dialog.image-inspector[open]");
  const inspectButtonOf = (image: Locator) =>
    image.locator(
      "xpath=following-sibling::div[contains(@class,'embed-actions')]//button",
    );
  // A double-click selects; it no longer opens the inspector.
  const doubleClickStaysClosed = async (target: Locator) => {
    await target.dblclick();
    await page.waitForTimeout(300);
    await expect(dialog).toHaveCount(0);
  };

  const standaloneImg = page.locator("img.note-image").first();
  await expect(standaloneImg).toBeVisible({ timeout: 10_000 });
  await doubleClickStaysClosed(standaloneImg);
  await inspectButtonOf(standaloneImg).dispatchEvent("click");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".media-area img")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  const inlineImg = page.locator('img[alt="InlineImage"]');
  await expect(inlineImg).toBeVisible();
  await inlineImg.click();
  await expect(inlineImg).toHaveClass(/md-image-selected/);
  const lineHasEmbedClass = await inlineImg.evaluate(
    (el) => el.closest(".cm-line")?.classList.contains("image-embed") ?? false,
  );
  expect(lineHasEmbedClass).toBe(false);
  await doubleClickStaysClosed(inlineImg);
  await inspectButtonOf(inlineImg).dispatchEvent("click");
  await expect(dialog).toBeVisible();
  // It stays open: the focus it takes does not draw the image again under
  // it (which would close it).
  await page.waitForTimeout(300);
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  const tableImg = page.locator(".cm-table-widget img").first();
  await expect(tableImg).toBeVisible();
  await doubleClickStaysClosed(tableImg);
  await inspectButtonOf(tableImg).dispatchEvent("click");
  await expect(dialog).toBeVisible();
  await dialog.locator('button[aria-label="Close image"]').click();
  await expect(dialog).toHaveCount(0);
  await expect(tableImg).toBeVisible();

  const mermaidSvg = page.locator('pre[data-fence="mermaid"] svg');
  await expect(mermaidSvg).toBeVisible({ timeout: 15_000 });
  await doubleClickStaysClosed(mermaidSvg);
  const inspectDiagramBtn = page.locator("button.inspect-diagram");
  await expect(inspectDiagramBtn).toHaveCount(1);
  await inspectDiagramBtn.dispatchEvent("click");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".media-area svg")).toBeVisible();
  await dialog.locator('button[aria-label="Zoom in"]').click();
  await dialog.locator('button[aria-label="Close diagram"]').click();
  await expect(dialog).toHaveCount(0);
});
