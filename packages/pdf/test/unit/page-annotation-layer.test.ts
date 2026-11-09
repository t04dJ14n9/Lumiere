import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const pagePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../src/webview/page.tsx",
);

/** The layers of `Page`, in the order its JSX stacks them (first is bottom). */
function layerOrder(): string[] {
  const source = readFileSync(pagePath, "utf8");
  const page = source.slice(source.indexOf("export function Page("));
  // To the end of the function: the text-selection wrapper closes a div early.
  const stack = page.slice(0, page.indexOf("\n}\n"));
  return [...stack.matchAll(/<([A-Z]\w+)/g)].map((match) => match[1]!);
}

test("Page mounts AnnotationLayer before SelectionLayer", () => {
  const order = layerOrder();
  const annotation = order.indexOf("AnnotationLayer");
  assert.ok(annotation >= 0, "AnnotationLayer is on the page");
  assert.ok(
    order.indexOf("SelectionLayer") > annotation,
    "AnnotationLayer must precede SelectionLayer in JSX",
  );
});

test("a page stacks its picture, search, links, marks, annotations, selection and backlinks, bottom to top", () => {
  const order = layerOrder();
  const wanted = [
    "RenderLayer",
    "LookUpWord",
    "SearchLayer",
    "PageLinks",
    "PageMarks",
    "AnnotationLayer",
    "SelectionLayer",
    "BacklinkLayer",
  ];
  assert.deepEqual(
    order.filter((layer) => wanted.includes(layer)),
    wanted,
  );
});

test("the search layer is drawn only while the search bar is open: its hooks cost every wheel event", () => {
  const source = readFileSync(pagePath, "utf8");
  assert.match(source, /searching && <SearchLayer \/>/);
});
