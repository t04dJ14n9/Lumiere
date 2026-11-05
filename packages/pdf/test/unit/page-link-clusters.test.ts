import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clusterPageLinks,
  type PageLinkInput,
} from "../../src/shared/page-link-clusters";

function rect(
  x: number,
  y: number,
  width: number,
  height: number,
): PageLinkInput["rect"] {
  return { origin: { x, y }, size: { width, height } };
}

function goto(
  id: string,
  r: PageLinkInput["rect"],
  page: number,
  top: number,
): PageLinkInput {
  return { id, rect: r, page, top };
}

function uri(id: string, r: PageLinkInput["rect"], url: string): PageLinkInput {
  return { id, rect: r, url };
}

function clusterIds(clusters: ReturnType<typeof clusterPageLinks>): string[][] {
  return clusters.map((cluster) => cluster.segmentIds);
}

test("adjacent same GoTo page+top become one cluster with multiple segment rects", () => {
  const author = goto("a", rect(100, 200, 50, 12), 10, 100);
  const year = goto("b", rect(153, 200, 22, 12), 10, 100); // ~3pt gap
  const clusters = clusterPageLinks([author, year]);
  assert.equal(clusters.length, 1);
  assert.deepEqual(clusters[0]!.segmentIds, ["a", "b"]);
  assert.equal(clusters[0]!.segments.length, 2);
  assert.equal(clusters[0]!.page, 10);
  assert.equal(clusters[0]!.top, 100);
  assert.deepEqual(clusters[0]!.segments[0], author.rect);
  assert.deepEqual(clusters[0]!.segments[1], year.rect);
});

test("adjacent same URI become one cluster", () => {
  const left = uri("u1", rect(40, 80, 60, 11), "https://example.com/a");
  const right = uri("u2", rect(104, 80, 40, 11), "https://example.com/a");
  const clusters = clusterPageLinks([left, right]);
  assert.equal(clusters.length, 1);
  assert.deepEqual(clusters[0]!.segmentIds, ["u1", "u2"]);
  assert.equal(clusters[0]!.url, "https://example.com/a");
});

test("distinct destinations stay unmerged even when adjacent", () => {
  const first = goto("p", rect(100, 200, 48, 12), 9, 200);
  const second = goto("z", rect(152, 200, 22, 12), 9, 350);
  const clusters = clusterPageLinks([first, second]);
  assert.equal(clusters.length, 2);
  assert.deepEqual(clusterIds(clusters).sort(), [["p"], ["z"]].sort());
});

test("same dest appearing twice far apart on a page yields two clusters", () => {
  const nearAuthor = goto("n1", rect(344, 284, 47, 12), 11, 192);
  const nearYear = goto("n2", rect(394, 284, 27, 12), 11, 192);
  const farAuthor = goto("f1", rect(124, 700, 48, 12), 11, 192);
  const farYear = goto("f2", rect(175, 700, 27, 12), 11, 192);
  const clusters = clusterPageLinks([nearAuthor, nearYear, farAuthor, farYear]);
  assert.equal(clusters.length, 2);
  const ids = clusterIds(clusters)
    .map((ids) => ids.slice().sort().join(","))
    .sort();
  assert.deepEqual(ids, ["f1,f2", "n1,n2"]);
});

test("two consecutive same-dest cites on adjacent lines stay two clusters", () => {
  // Year of cite N + author of cite N+1 satisfy wrap geometry; must not
  // transitively merge into one four-segment cluster.
  const a1 = goto("a1", rect(100, 200, 50, 12), 10, 100);
  const y1 = goto("y1", rect(153, 200, 22, 12), 10, 100);
  const a2 = goto("a2", rect(100, 214, 50, 12), 10, 100);
  const y2 = goto("y2", rect(153, 214, 22, 12), 10, 100);
  const clusters = clusterPageLinks([a1, y1, a2, y2]);
  assert.equal(clusters.length, 2);
  const ids = clusterIds(clusters)
    .map((ids) => ids.slice().sort().join(","))
    .sort();
  assert.deepEqual(ids, ["a1,y1", "a2,y2"]);
});

test("line-wrap: end-of-line + start-of-next-line same dest become one cluster", () => {
  // Real shape from arXiv 2503.20783 page 2: author ends near right margin,
  // year starts on the next line near the left margin (~3pt vertical overlap).
  const author = goto("w1", rect(462.86, 294.93, 40.86, 12.06), 10, 384);
  const year = goto("w2", rect(107, 305.89, 27.38, 11.82), 10, 384);
  const clusters = clusterPageLinks([author, year]);
  assert.equal(clusters.length, 1);
  assert.deepEqual(clusters[0]!.segmentIds, ["w1", "w2"]);
});

test("single-rect links are unchanged", () => {
  const only = goto("solo", rect(72, 100, 120, 14), 5, 130);
  const clusters = clusterPageLinks([only]);
  assert.equal(clusters.length, 1);
  assert.deepEqual(clusters[0]!.segmentIds, ["solo"]);
  assert.equal(clusters[0]!.segments.length, 1);
  assert.equal(clusters[0]!.page, 5);
  assert.equal(clusters[0]!.top, 130);
});

test("GoTo and URI never merge with each other", () => {
  const internal = goto("g", rect(100, 200, 40, 12), 3, 50);
  const external = uri("e", rect(144, 200, 40, 12), "https://example.com");
  const clusters = clusterPageLinks([internal, external]);
  assert.equal(clusters.length, 2);
});

test("empty input yields no clusters", () => {
  assert.deepEqual(clusterPageLinks([]), []);
});
