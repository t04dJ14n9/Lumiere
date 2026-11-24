import assert from "node:assert/strict";
import { test } from "node:test";
import type { OutlineItem } from "../../src/shared/messages";
import {
  DESTINATION_TOLERANCE,
  findActiveOutlineItem,
  flattenOutlineForPicker,
  followPosition,
} from "../../src/shared/outline";

const heading = (
  title: string,
  page: number,
  top?: number,
  children: OutlineItem[] = [],
): OutlineItem => ({
  title,
  page,
  ...(top === undefined ? {} : { top }),
  children,
});

test("no active bookmark for an empty tree or a position before its first destination", () => {
  const first = heading("First", 3, 100);
  assert.equal(findActiveOutlineItem([], { page: 1 }), undefined);
  assert.equal(
    findActiveOutlineItem([first], { page: 2, top: 999 }),
    undefined,
  );
  assert.equal(
    findActiveOutlineItem([first], { page: 3, top: 98.9 }),
    undefined,
  );
});

test("a heading stays active across pages until the next heading, including after the final one", () => {
  const intro = heading("Introduction", 1);
  const chapter = heading("Chapter", 5);
  for (const page of [1, 2, 4]) {
    assert.equal(findActiveOutlineItem([intro, chapter], { page }), intro);
  }
  for (const page of [5, 6, 100]) {
    assert.equal(findActiveOutlineItem([intro, chapter], { page }), chapter);
  }
});

test("headings on the same page change at their vertical destinations, less a point of rounding", () => {
  assert.equal(DESTINATION_TOLERANCE, 1);
  const first = heading("Start", 2);
  const middle = heading("Middle", 2, 120.5);
  const end = heading("End", 2, 300);
  const items = [first, middle, end];
  assert.equal(findActiveOutlineItem(items, { page: 2 }), first);
  assert.equal(findActiveOutlineItem(items, { page: 2, top: 119.4 }), first);
  assert.equal(findActiveOutlineItem(items, { page: 2, top: 119.5 }), middle);
  assert.equal(findActiveOutlineItem(items, { page: 2, top: 120.5 }), middle);
  assert.equal(findActiveOutlineItem(items, { page: 2, top: 298.9 }), middle);
  assert.equal(findActiveOutlineItem(items, { page: 2, top: 299 }), end);
  assert.equal(findActiveOutlineItem(items, { page: 2, top: 300 }), end);
  assert.equal(findActiveOutlineItem(items, { page: 3 }), end);
});

test("nested headings remain active until a later sibling section begins", () => {
  const child = heading("Child", 2);
  const chapter = heading("Chapter", 1, undefined, [child]);
  const next = heading("Next chapter", 6);
  assert.equal(findActiveOutlineItem([chapter, next], { page: 1 }), chapter);
  assert.equal(findActiveOutlineItem([chapter, next], { page: 4 }), child);
  assert.equal(findActiveOutlineItem([chapter, next], { page: 6 }), next);
});

test("identical destinations prefer the deepest heading, even when a shallow sibling follows it", () => {
  const deepest = heading("Deepest", 3, 0);
  const child = heading("Child", 3, undefined, [deepest]);
  const parent = heading("Parent", 3, 0, [child]);
  assert.equal(
    findActiveOutlineItem([parent, heading("Alias", 3)], { page: 3 }),
    deepest,
  );
});

test("equal destinations at the same depth deterministically choose the later bookmark", () => {
  const first = heading("First alias", 3);
  const last = heading("Last alias", 3, 0);
  assert.equal(findActiveOutlineItem([first, last], { page: 3 }), last);
});

test("group and external entries are skipped while their local children are searched", () => {
  const local = heading("Local", 4);
  const group: OutlineItem = {
    title: "Group",
    children: [{ title: "External", children: [local] }],
  };
  assert.equal(findActiveOutlineItem([group], { page: 3 }), undefined);
  assert.equal(findActiveOutlineItem([group], { page: 4 }), local);
  assert.equal(
    findActiveOutlineItem([{ title: "External", children: [] }], { page: 10 }),
    undefined,
  );
});

test("unsorted destinations follow page and offset order without changing the bookmark tree", () => {
  const later = heading("Later", 8);
  const high = heading("High", 2, 400);
  const low = heading("Low", 2, 100);
  const items = [later, high, low];
  assert.equal(findActiveOutlineItem(items, { page: 2, top: 200 }), low);
  assert.equal(findActiveOutlineItem(items, { page: 2, top: 500 }), high);
  assert.equal(findActiveOutlineItem(items, { page: 8 }), later);
  assert.deepEqual(items, [later, high, low]);
});

test("flattenOutlineForPicker lists navigable bookmarks with page labels and ancestor detail", () => {
  const child = heading("Child", 2, 40);
  const group: OutlineItem = {
    title: "Group",
    children: [child, { title: "External", children: [] }],
  };
  const root = heading("Root", 1, undefined, [group]);
  assert.deepEqual(flattenOutlineForPicker([root]), [
    { title: "Root", page: 1, description: "p.1" },
    {
      title: "Child",
      page: 2,
      top: 40,
      description: "p.2",
      detail: "Root › Group",
    },
  ]);
  assert.deepEqual(flattenOutlineForPicker([]), []);
});

test("the position Follow Cursor follows is the page shown, and the offset only where it belongs to that page", () => {
  // Alone on its page, the reader's offset is where they are in it.
  assert.deepEqual(followPosition({ page: 3, readingPage: 3, top: 120 }), {
    page: 3,
    top: 120,
  });
  // In a spread, or at the end of a PDF, the page shown can come after the
  // first visible one: the offset belongs to the earlier page, so the shown
  // page counts from its top.
  assert.deepEqual(followPosition({ page: 4, readingPage: 3, top: 300 }), {
    page: 4,
    top: 0,
  });
});

test("in a spread the Explorer and the side panel select the heading at the top of the page shown, not the earlier one", () => {
  const earlier = heading("Earlier", 3, 100);
  const later = heading("Later", 4);
  const view = { page: 4, readingPage: 3, top: 300 };
  // The offset 300 of page 3 would pass "Earlier" and stop there; the rule
  // takes the heading at the top of page 4.
  assert.equal(
    findActiveOutlineItem([earlier, later], followPosition(view)),
    later,
  );
  assert.equal(
    findActiveOutlineItem([earlier, later], { page: 3, top: view.top }),
    earlier,
  );
});

test("a jump to a bookmark that lands a fraction short, in whole device pixels, is at that bookmark, not its parent", () => {
  // VS Code read Section 2.1's destination (page 9, 130 points) back as 129.87.
  const section = heading("Section 2.1", 9, 130);
  const part = heading("Part Two", 6, undefined, [section]);
  assert.equal(
    findActiveOutlineItem([part], { page: 9, top: 129.87 }),
    section,
  );
  assert.equal(findActiveOutlineItem([part], { page: 9, top: 128.5 }), part);
});
