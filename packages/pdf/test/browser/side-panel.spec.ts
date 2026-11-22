import { expect, test, type Locator, type Page } from "@playwright/test";
import type { ViewerMessage } from "../../src/shared/messages";
import type { SidePanelState } from "../../src/shared/side-panel";
import {
  lastSelection,
  pagePoint,
  selectText,
  TEXT_MIDLINE,
} from "./viewer-support";
import { act, lastView, openView, send } from "./view-controls-support";

/**
 * The side panel inside the viewer (#867): hidden until the extension says
 * it is open, then Thumbnails, Outline, Bookmarks and Annotations, each of
 * which takes the viewer to a place. The harness stands in for the extension:
 * `?sidePanel=` is the state it sends with the load, and `send` is a message
 * it sends later. outline.pdf has Part One (page 1) with Section 1.1 (2) and
 * 1.2 (3), and Part Two (6) with Section 2.1 (9, 130 points down).
 */
const OPEN: SidePanelState = { open: true, width: 240, tab: "outline" };

async function openPanel(
  page: Page,
  state: Partial<SidePanelState> = {},
  extra = "",
): Promise<void> {
  const sidePanel = encodeURIComponent(JSON.stringify({ ...OPEN, ...state }));
  await openView(
    page,
    { smoothScrolling: false },
    "chrome",
    `&sidePanel=${sidePanel}${extra}`,
  );
  await expect(page.locator(".side-panel")).toBeVisible();
}

/** What the viewer sent the extension, of one type. */
async function sent<T extends ViewerMessage["type"]>(
  page: Page,
  type: T,
): Promise<Extract<ViewerMessage, { type: T }>[]> {
  return page.evaluate(
    (type) =>
      (window as unknown as { __messages: ViewerMessage[] }).__messages.filter(
        (message) => message.type === type,
      ),
    type,
  ) as Promise<Extract<ViewerMessage, { type: T }>[]>;
}

const tree = (page: Page, name: string) =>
  page.locator(
    `[role="tree"][aria-label="${name}"], [role="listbox"][aria-label="${name}"]`,
  );

async function widthOf(locator: Locator): Promise<number> {
  return (await locator.boundingBox())!.width;
}

async function chooseTab(page: Page, name: string): Promise<void> {
  await page.getByRole("tab", { name, exact: true }).click();
  await expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
}

/** The page at the top of the viewer, and how far down it the viewer starts. */
async function reading(page: Page) {
  const view = (await lastView(page))!;
  return { page: view.readingPage, top: view.top };
}

test("the panel stays closed until the extension opens it, and the pages make room", async ({
  page,
}) => {
  await openView(page, { smoothScrolling: false }, "chrome");
  await expect(page.locator(".side-panel")).toHaveCount(0);
  const whole = await widthOf(page.locator(".viewport"));
  await send(page, { type: "sidePanel", state: { ...OPEN, width: 260 } });
  await expect(page.getByRole("tablist", { name: "Side panel" })).toBeVisible();
  expect(await widthOf(page.locator(".side-panel"))).toBe(260);
  expect(await widthOf(page.locator(".viewport"))).toBeCloseTo(whole - 260, 0);
  await send(page, { type: "sidePanel", state: { ...OPEN, open: false } });
  await expect(page.locator(".side-panel")).toHaveCount(0);
  expect(await widthOf(page.locator(".viewport"))).toBeCloseTo(whole, 0);
});

test("opening the panel does not take the keyboard from the pages", async ({
  page,
}) => {
  await openPanel(page);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.activeElement?.closest(".side-panel") ?? null,
      ),
    )
    .toBeNull();
  const before = await reading(page);
  await page.keyboard.press("PageDown");
  await expect.poll(() => reading(page)).not.toEqual(before);
});

test("the Outline tab lists the bookmarks, with the reading place's branch open", async ({
  page,
}) => {
  await openPanel(page);
  const outline = tree(page, "Outline");
  await expect(outline.getByRole("treeitem")).toHaveText([
    /Part One/u,
    /Section 1\.1/u,
    /Section 1\.2/u,
    /Part Two/u,
  ]);
  const partOne = outline.getByRole("treeitem", { name: /^Part One/u });
  await expect(partOne).toHaveAttribute("aria-expanded", "true");
  await expect(partOne).toHaveAttribute("aria-level", "1");
  await expect(partOne).toHaveAttribute("aria-selected", "true");
  await expect(
    outline.getByRole("treeitem", { name: /^Section 1\.1/u }),
  ).toHaveAttribute("aria-level", "2");
});

test("a click on an outline entry goes to its page and place, and Back can return", async ({
  page,
}) => {
  await openPanel(page);
  const outline = tree(page, "Outline");
  await outline.getByRole("treeitem", { name: /^Section 1\.2/u }).click();
  await expect.poll(() => reading(page)).toMatchObject({ page: 3 });
  await expect
    .poll(async () => (await sent(page, "historyJump")).length)
    .toBe(1);
  // Part Two has the branch to itself once the reader is there.
  await outline.getByRole("treeitem", { name: /^Part Two/u }).click();
  await expect.poll(() => reading(page)).toMatchObject({ page: 6 });
  await outline.getByRole("treeitem", { name: /^Section 2\.1/u }).click();
  await expect.poll(() => reading(page)).toMatchObject({ page: 9 });
  expect((await reading(page)).top).toBeCloseTo(130, 0);
});

test("Follow Cursor keeps the reading position's bookmark selected, its branch open and the others closed", async ({
  page,
}) => {
  await openPanel(page);
  const outline = tree(page, "Outline");
  // At the top of page 9 the reader has reached Part Two, not yet Section 2.1.
  await act(page, { action: "goToPage", page: 9 });
  const partTwo = outline.getByRole("treeitem", { name: /^Part Two/u });
  await expect(partTwo).toHaveAttribute("aria-selected", "true");
  await expect(partTwo).toHaveAttribute("aria-expanded", "true");
  await expect(
    outline.getByRole("treeitem", { name: /^Part One/u }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(
    outline.getByRole("treeitem", { name: /^Section 1\.1/u }),
  ).toHaveCount(0);
  // Down the page to Section 2.1's place, it is the one selected.
  await send(page, { type: "goTo", location: { page: 9 }, top: 140 });
  await expect(
    outline.getByRole("treeitem", { name: /^Section 2\.1/u }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(partTwo).toHaveAttribute("aria-selected", "false");
});

test("a click selects its row at once and keeps it through the hold, until the reader moves on", async ({
  page,
}) => {
  await openPanel(page);
  const outline = tree(page, "Outline");
  const partOne = outline.getByRole("treeitem", { name: /^Part One/u });
  const section = outline.getByRole("treeitem", { name: /^Section 1\.2/u });
  // Follow Cursor had Part One selected, and the click does not wait for it.
  await expect(partOne).toHaveAttribute("aria-selected", "true");
  await section.click();
  await expect(section).toHaveAttribute("aria-selected", "true");
  await expect(partOne).toHaveAttribute("aria-selected", "false");
  await expect.poll(() => reading(page)).toMatchObject({ page: 3 });
  // Through the hold and after it, while the reader stays where the click landed.
  await page.waitForTimeout(1400);
  await expect(section).toHaveAttribute("aria-selected", "true");
  // Moving on gives the selection back to Follow Cursor.
  await act(page, { action: "goToPage", page: 9 });
  await expect(
    outline.getByRole("treeitem", { name: /^Part Two/u }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    outline.getByRole("treeitem", { name: /^Section 1\.2/u }),
  ).toHaveCount(0);
});

test("Follow Cursor off leaves the branches as the reader opened them", async ({
  page,
}) => {
  const view = encodeURIComponent(
    JSON.stringify({ smoothScrolling: false, outlineFollowCursor: false }),
  );
  const sidePanel = encodeURIComponent(JSON.stringify(OPEN));
  await page.goto(`/?toolbar=chrome&view=${view}&sidePanel=${sidePanel}`);
  const outline = tree(page, "Outline");
  await expect(outline.getByRole("treeitem")).toHaveText([
    /Part One/u,
    /Part Two/u,
  ]);
  await act(page, { action: "goToPage", page: 9 });
  await expect(
    outline.getByRole("treeitem", { name: /^Part Two/u }),
  ).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "Expand All" }).click();
  await expect(outline.getByRole("treeitem")).toHaveCount(5);
  await page.getByRole("button", { name: "Collapse All" }).click();
  await expect(outline.getByRole("treeitem")).toHaveCount(2);
});

test("Follow Cursor is read at each move, so changing the setting takes effect without leaving the page", async ({
  page,
}) => {
  await openPanel(page);
  const outline = tree(page, "Outline");
  const partTwo = outline.getByRole("treeitem", { name: /^Part Two/u });
  const section = outline.getByRole("treeitem", { name: /^Section 2\.1/u });
  const settings = (outlineFollowCursor: boolean) => ({
    type: "viewSettings" as const,
    settings: {
      defaultZoom: "fitWidth" as const,
      pageLayout: "single" as const,
      scrollMode: "continuous" as const,
      scrollDirection: "vertical" as const,
      smoothScrolling: false,
      regionsEnabled: false,
      arrowsKeepPlace: true,
      outlineFollowCursor,
    },
  });
  await act(page, { action: "goToPage", page: 9 });
  await expect(partTwo).toHaveAttribute("aria-selected", "true");
  // Off: the next move, on this same page, selects nothing new.
  await send(page, settings(false));
  await send(page, { type: "goTo", location: { page: 9 }, top: 140 });
  await expect(partTwo).toHaveAttribute("aria-selected", "false");
  await expect(section).toHaveAttribute("aria-selected", "false");
  // On again: the next move on the same page follows.
  await send(page, settings(true));
  await send(page, { type: "goTo", location: { page: 9 }, top: 150 });
  await expect(section).toHaveAttribute("aria-selected", "true");
});

test("the tree is a VS Code tree to the keyboard: arrows move and fold, Enter opens", async ({
  page,
}) => {
  await openPanel(page);
  const outline = tree(page, "Outline");
  const names = () =>
    outline.evaluate((element) => {
      const id = element.getAttribute("aria-activedescendant");
      return document.getElementById(id ?? "")?.textContent ?? null;
    });
  await outline.focus();
  await page.keyboard.press("End");
  await expect.poll(names).toMatch(/^Part Two/u);
  const before = await reading(page);
  // Right opens a closed branch, then steps into it; Left steps out, then closes.
  await page.keyboard.press("ArrowRight");
  await expect(
    outline.getByRole("treeitem", { name: /^Part Two/u }),
  ).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("ArrowRight");
  await expect.poll(names).toMatch(/^Section 2\.1/u);
  await page.keyboard.press("ArrowLeft");
  await expect.poll(names).toMatch(/^Part Two/u);
  await page.keyboard.press("ArrowLeft");
  await expect(
    outline.getByRole("treeitem", { name: /^Part Two/u }),
  ).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Home");
  await expect.poll(names).toMatch(/^Part One/u);
  await page.keyboard.press("ArrowDown");
  await expect.poll(names).toMatch(/^Section 1\.1/u);
  // The keys were the tree's: nothing turned a page.
  expect(await reading(page)).toEqual(before);
  await page.keyboard.press("Enter");
  await expect.poll(() => reading(page)).toMatchObject({ page: 2 });
});

test("the tabs are a tablist the arrow keys move along, each with its own panel", async ({
  page,
}) => {
  await openPanel(page);
  const outlineTab = page.getByRole("tab", { name: "Outline", exact: true });
  await outlineTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Bookmarks", exact: true }),
  ).toBeFocused();
  const panel = page.getByRole("tabpanel");
  await expect(panel).toHaveAttribute("aria-labelledby", "sp-tab-bookmarks");
  await page.keyboard.press("End");
  await expect(panel).toHaveAttribute("aria-labelledby", "sp-tab-annotations");
  await page.keyboard.press("Home");
  await expect(panel).toHaveAttribute("aria-labelledby", "sp-tab-thumbnails");
  // The panel is not one of the page's keys: Left from the first goes round.
  await page.keyboard.press("ArrowLeft");
  await expect(panel).toHaveAttribute("aria-labelledby", "sp-tab-annotations");
});

test("the Thumbnails tab draws the pages in view, marks the one being read, and goes to a page on a click", async ({
  page,
}) => {
  await openPanel(page, { tab: "thumbnails" });
  const pages = tree(page, "Thumbnails");
  await expect(pages.getByRole("option", { name: "Page 1" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    pages.getByRole("option", { name: "Page 1" }).locator("img"),
  ).toBeVisible();
  await expect(
    pages.getByRole("option", { name: "Page 3" }).locator("img"),
  ).toBeVisible();
  await pages.getByRole("option", { name: "Page 3" }).click();
  await expect.poll(() => reading(page)).toMatchObject({ page: 3 });
  await expect(pages.getByRole("option", { name: "Page 3" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  // Reading on moves the mark, and scrolls the list to it.
  await act(page, { action: "goToPage", page: 12 });
  await expect(pages.getByRole("option", { name: "Page 12" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(pages.getByRole("option", { name: "Page 12" })).toBeInViewport();
});

test("thumbnails of a long PDF are drawn only where the list is, and again where it goes", async ({
  page,
}) => {
  await openPanel(page, { tab: "thumbnails" }, "&pdf=large.pdf");
  const pages = tree(page, "Thumbnails");
  await expect(
    pages.getByRole("option", { name: "Page 1" }).locator("img"),
  ).toBeVisible();
  const drawn = await pages.getByRole("option").count();
  expect(drawn).toBeLessThan(25);
  await expect(pages.getByRole("option").first()).toHaveAttribute(
    "aria-setsize",
    "600",
  );
  await pages.focus();
  await page.keyboard.press("End");
  const last = pages.getByRole("option", { name: "Page 600" });
  await expect(last).toBeInViewport();
  await expect(last.locator("img")).toBeVisible();
  expect(await pages.getByRole("option").count()).toBeLessThan(25);
  // Enter on the focused page goes there, and the list's keys did not turn a page first.
  await page.keyboard.press("Enter");
  // The last page cannot scroll to the top, so the page above it is first.
  await expect.poll(async () => (await lastView(page))!.page).toBe(600);
});

test("the Bookmarks tab lists what the extension sends, goes to one, and asks the extension to add, rename and delete", async ({
  page,
}) => {
  await openPanel(page, { tab: "bookmarks" });
  await expect(
    page.getByText("You have not added any bookmarks"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add Bookmark" }).first().click();
  expect(await sent(page, "bookmarkAction")).toEqual([
    { type: "bookmarkAction", action: "add" },
  ]);
  await send(page, {
    type: "bookmarks",
    items: [
      bookmark("a", "The abstract", 1, 0),
      bookmark("b", "Where the proof starts", 5, 130),
    ],
  });
  const list = tree(page, "Bookmarks");
  await expect(list.getByRole("option")).toHaveText([
    /The abstract/u,
    /Where the proof starts/u,
  ]);
  // The extension sends them in page order; the panel lists them as sent.
  await list.getByRole("option", { name: /^Where the proof starts/u }).click();
  await expect.poll(() => reading(page)).toMatchObject({ page: 5 });
  expect((await reading(page)).top).toBeCloseTo(130, 0);
  await list.focus();
  await page.keyboard.press("F2");
  await page.keyboard.press("Delete");
  expect((await sent(page, "bookmarkAction")).slice(1)).toEqual([
    { type: "bookmarkAction", action: "rename", id: "b" },
    { type: "bookmarkAction", action: "delete", id: "b" },
  ]);
  const abstract = list.getByRole("option", { name: /^The abstract/u });
  await abstract.hover();
  await abstract.getByRole("button", { name: "Rename Bookmark" }).click();
  expect((await sent(page, "bookmarkAction")).at(-1)).toEqual({
    type: "bookmarkAction",
    action: "rename",
    id: "a",
  });
});

test("a bookmark list the extension could not read says why", async ({
  page,
}) => {
  await openPanel(page, { tab: "bookmarks" });
  await send(page, {
    type: "bookmarks",
    items: [],
    problem: "Cannot use the file. It was written by a newer version.",
  });
  await expect(page.getByText("written by a newer version")).toBeVisible();
});

test("the Annotations tab lists every mark in reading order, and a click goes to the mark", async ({
  page,
}) => {
  await openPanel(page, { tab: "annotations" });
  await expect(page.getByText("This PDF has no annotations.")).toBeVisible();
  const at = await pagePoint(page, 1);
  await selectText(page, at(74, TEXT_MIDLINE), at(205, TEXT_MIDLINE));
  await expect
    .poll(async () => (await lastSelection(page)) as { kind?: string } | null)
    .toMatchObject({ kind: "text" });
  await act(page, { action: "markSelection", tool: "highlight" });
  const marks = tree(page, "Annotations");
  const row = marks.getByRole("option").first();
  await expect(row).toContainText("Synthetic page 1");
  await expect(row).toContainText("p. 1");
  await expect(row.locator(".codicon-edit")).toBeVisible();
  await expect(row.locator(".sp-swatch")).toBeVisible();
  await act(page, { action: "goToPage", page: 8 });
  await expect.poll(() => reading(page)).toMatchObject({ page: 8 });
  await row.click();
  await expect.poll(() => reading(page)).toMatchObject({ page: 1 });
  await expect(row).toHaveAttribute("aria-selected", "true");
});

test("dragging the sash resizes the panel within its limits, and the extension is told once, when it ends", async ({
  page,
}) => {
  await openPanel(page);
  const panel = page.locator(".side-panel");
  const sash = page.getByRole("separator", { name: "Resize Side Panel" });
  const box = (await sash.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 102, y, { steps: 5 });
  await expect.poll(() => widthOf(panel)).toBe(340);
  expect(await sent(page, "sidePanel")).toHaveLength(0);
  await page.mouse.up();
  await expect.poll(async () => (await sent(page, "sidePanel")).length).toBe(1);
  expect((await sent(page, "sidePanel"))[0]!.state).toMatchObject({
    open: true,
    width: 340,
  });
  // Dragged past the limits it stops at them: 160 px, and 60 % of the viewer.
  const edge = (await sash.boundingBox())!;
  await page.mouse.move(edge.x + 2, y);
  await page.mouse.down();
  await page.mouse.move(2, y, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => widthOf(panel)).toBe(160);
  const next = (await sash.boundingBox())!;
  await page.mouse.move(next.x + 2, y);
  await page.mouse.down();
  await page.mouse.move(990, y, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => widthOf(panel)).toBe(600);
  await sash.dblclick();
  await expect.poll(() => widthOf(panel)).toBe(240);
});

test("the sash has the keyboard too, and the panel can be hidden from its own button", async ({
  page,
}) => {
  await openPanel(page);
  const sash = page.getByRole("separator", { name: "Resize Side Panel" });
  await sash.focus();
  await page.keyboard.press("ArrowRight");
  await expect(sash).toHaveAttribute("aria-valuenow", "256");
  await page.keyboard.press("Shift+ArrowLeft");
  await expect(sash).toHaveAttribute("aria-valuenow", "192");
  expect((await sent(page, "sidePanel")).map((m) => m.state.width)).toEqual([
    256, 192,
  ]);
  await page.getByRole("button", { name: "Hide Side Panel" }).click();
  await expect(page.locator(".side-panel")).toHaveCount(0);
  expect((await sent(page, "sidePanel")).at(-1)!.state.open).toBe(false);
});

test("a viewer made anew for a changed file keeps the panel as the reader left it", async ({
  page,
}) => {
  await openPanel(page);
  await chooseTab(page, "Bookmarks");
  await send(page, {
    type: "sidePanel",
    state: { ...OPEN, width: 300, tab: "bookmarks" },
  });
  await page.evaluate(async () => {
    const bytes = await (await fetch("/fixtures/outline.pdf")).arrayBuffer();
    (window as unknown as { hostSend(m: unknown): void }).hostSend({
      type: "load",
      data: bytes,
      settings: {},
      // A load that left before the choice arrived says the old state.
      sidePanel: { open: false, width: 240, tab: "outline" },
    });
  });
  await expect(page.locator(".page img").first()).toBeVisible();
  await expect(page.locator(".side-panel")).toBeVisible();
  expect(await widthOf(page.locator(".side-panel"))).toBe(300);
  await expect(
    page.getByRole("tab", { name: "Bookmarks", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
});

function bookmark(id: string, title: string, page: number, top: number) {
  return {
    id,
    title,
    page,
    position: { top, left: 0 },
    created: "2026-11-23T08:00:00.000Z",
  };
}
