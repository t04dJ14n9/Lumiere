/**
 * A column's right border, in any row, is its resize handle: hovering it
 * shows the resize cursor and a guide down the table; dragging it sets the
 * column's width live and, on release, in the `lumiere-col-widths` comment
 * after the table. The handles used to sit inside the header's first line
 * only, a few pixels left of the border, so pressing the border did nothing.
 */
import { test, expect, type Page } from "@playwright/test";
import { open } from "./harness";

const TABLE = `| Name | Role | Notes |
| --- | --- | --- |
| Ada | math | first cell with a longer note so the column is wide |
| Grace | code | second cell |`;

const DOC = `Before the table.\n\n${TABLE}\n\nAfter the table.\n`;

const NO_VIM = { features: { vim: { enabled: false, config: {} } } };

async function widths(page: Page): Promise<number[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll(".hybrid-table tr:first-child > *")]
      .slice(0, 3)
      .map((cell) => Math.round(cell.getBoundingClientRect().width)),
  );
}

/** The right border of a cell of the rendered table, mid-height. */
async function border(page: Page, row: number, column: number) {
  const cell = page
    .locator(".hybrid-table tr")
    .nth(row)
    .locator("> *")
    .nth(column);
  const box = (await cell.boundingBox())!;
  return { x: box.x + box.width, y: box.y + box.height / 2 };
}

function source(page: Page): Promise<string> {
  return page.evaluate(() => window.harness.text);
}

test("dragging a column's border in a body row resizes it live and saves the widths", async ({
  page,
}) => {
  await open(page, DOC, "obsidian", NO_VIM);
  const before = await widths(page);
  const at = await border(page, 2, 0);
  await page.mouse.move(at.x - 1, at.y);
  const table = page.locator(".hybrid-table");
  await expect(table).toHaveClass(/table-col-resize-hover/);
  const cursor = await page.evaluate(
    ({ x, y }) => getComputedStyle(document.elementFromPoint(x, y)!).cursor,
    { x: at.x - 1, y: at.y },
  );
  expect(cursor).toBe("col-resize");
  const guide = page.locator(".table-col-resize-guide");
  await expect(guide).toBeVisible();
  const tableBox = (await page.locator(".table-editor").boundingBox())!;
  const guideBox = (await guide.boundingBox())!;
  expect(Math.abs(guideBox.x + guideBox.width / 2 - at.x)).toBeLessThan(2);
  expect(Math.abs(guideBox.height - tableBox.height)).toBeLessThan(2);

  await page.mouse.down();
  for (let step = 1; step <= 6; step++) {
    await page.mouse.move(at.x - 1 + step * 10, at.y);
    const live = await widths(page);
    expect(live[0]).toBe(before[0]! + step * 10);
    expect(live.slice(1), "the other columns stay").toEqual(before.slice(1));
  }
  await page.mouse.up();
  const wide = before[0]! + 60;
  await expect
    .poll(() => source(page))
    .toBe(
      DOC.replace(
        TABLE,
        `${TABLE}\n<!-- lumiere-col-widths: ${wide},${before[1]},${before[2]} -->`,
      ),
    );
  expect(await widths(page)).toEqual([wide, before[1], before[2]]);
  await expect(page.getByRole("textbox", { name: /^Table cell/ })).toHaveCount(
    0,
  );
});

test("a press on a border that does not move writes nothing and opens no cell", async ({
  page,
}) => {
  await open(page, DOC, "obsidian", NO_VIM);
  const before = await widths(page);
  const at = await border(page, 2, 1);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(200);
  expect(await source(page)).toBe(DOC);
  expect(await widths(page)).toEqual(before);
  await expect(page.getByRole("textbox", { name: /^Table cell/ })).toHaveCount(
    0,
  );
  // A little further in, the press is the cell's again.
  await page.mouse.click(at.x - 12, at.y);
  await expect(
    page.getByRole("textbox", { name: "Table cell 3, 2", exact: true }),
  ).toBeFocused();
});

test("a column does not go below its minimum, and saved widths come back on open", async ({
  page,
}) => {
  const saved = DOC.replace(
    TABLE,
    `${TABLE}\n<!-- lumiere-col-widths: 150,90,300 -->`,
  );
  await open(page, saved, "obsidian", NO_VIM);
  expect(await widths(page)).toEqual([150, 90, 300]);
  const at = await border(page, 0, 0);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x - 200, at.y, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(() => source(page))
    .toContain("<!-- lumiere-col-widths: 60,90,300 -->");
  expect(await widths(page)).toEqual([60, 90, 300]);
});

test("a table in a list item stays in it: all its rows, a resize, a cell edit and an added row", async ({
  page,
}) => {
  const listed =
    "- item one\n\n  | a | b |\n  | --- | --- |\n  | 1 | 2 |\n\n- item two\n";
  await open(page, listed, "obsidian", NO_VIM);
  // The rows are indented under the item; they used to end the table.
  await expect(page.locator(".hybrid-table tr")).toHaveCount(2);

  const at = await border(page, 1, 0);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 40, at.y, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(() => source(page))
    .toMatch(
      /^- item one\n\n {2}\| a \| b \|\n {2}\| --- \| --- \|\n {2}\| 1 \| 2 \|\n {2}<!-- lumiere-col-widths: \d+,\d+ -->\n\n- item two\n$/,
    );
  const comment = /<!-- lumiere-col-widths: \d+,\d+ -->/.exec(
    await source(page),
  )![0];

  await page.locator(".hybrid-table .table-cell-content").nth(2).click();
  await page.keyboard.press("End");
  await page.keyboard.type("xyz");
  await page.keyboard.press("Escape");
  await expect
    .poll(() => source(page))
    .toBe(
      `- item one\n\n  | a    | b   |\n  | ---- | --- |\n  | 1xyz | 2   |\n  ${comment}\n\n- item two\n`,
    );

  await page.locator(".hybrid-table").hover();
  await page.getByRole("button", { name: "Add row below" }).click();
  await expect
    .poll(() => source(page))
    .toBe(
      `- item one\n\n  | a    | b   |\n  | ---- | --- |\n  | 1xyz | 2   |\n  |      |     |\n  ${comment}\n\n- item two\n`,
    );
});

test("adding a row keeps the saved widths", async ({ page }) => {
  const saved = DOC.replace(
    TABLE,
    `${TABLE}\n<!-- lumiere-col-widths: 150,90,300 -->`,
  );
  await open(page, saved, "obsidian", NO_VIM);
  await page.locator(".hybrid-table").hover();
  await page.getByRole("button", { name: "Add row below" }).click();
  await expect
    .poll(() => source(page))
    .toMatch(/\| +\| +\| +\|\n<!-- lumiere-col-widths: 150,90,300 -->\n/);
  expect(await widths(page)).toEqual([150, 90, 300]);
});
