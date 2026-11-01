import assert from "node:assert/strict";
import { test } from "node:test";
import { parseViewerMessage } from "../../src/shared/messages";
import { parseSelection } from "../../src/shared/selection";
import { parseSidecarHighlights } from "../../src/shared/sidecar-messages";

const highlight = {
  id: "hl-a1b2c3d4",
  page: 3,
  subtype: "highlight",
  color: "#FFE566",
  opacity: 0.45,
  segmentRects: [{ x: 72, y: 410, w: 220, h: 12 }],
  quote: "scaled dot-product attention",
  contextBefore: "We propose ",
  contextAfter: " as the core",
  created: "2026-11-01T18:00:00.000Z",
  modified: "2026-11-01T18:00:00.000Z",
};

test("the viewer may write a well-formed highlight to the sidecar, or delete one", () => {
  assert.deepEqual(
    parseViewerMessage({
      type: "sidecarWrite",
      load: 2,
      op: "upsert",
      highlight: { ...highlight, extra: "dropped" },
    }),
    { type: "sidecarWrite", load: 2, op: "upsert", highlight },
  );
  assert.deepEqual(
    parseViewerMessage({
      type: "sidecarWrite",
      load: 2,
      op: "delete",
      id: "hl-x",
    }),
    { type: "sidecarWrite", load: 2, op: "delete", id: "hl-x" },
  );
});

test("a sidecar write with any bad field is refused", () => {
  const bad: Record<string, unknown>[] = [
    { id: "hl-has space" },
    { id: 7 },
    { page: 0 },
    { page: 1.5 },
    { color: "red" },
    { opacity: 0 },
    { opacity: 2 },
    { segmentRects: [] },
    { segmentRects: [{ x: 1, y: 1, w: 0, h: 1 }] },
    { segmentRects: [{ x: 1, y: 1, w: 1 }] },
    { segmentRects: [{ x: Infinity, y: 1, w: 1, h: 1 }] },
    { segmentRects: Array(2_001).fill({ x: 1, y: 1, w: 1, h: 1 }) },
    { quote: "x".repeat(2_001) },
    { contextBefore: 3 },
    { modified: undefined },
  ];
  for (const change of bad) {
    assert.equal(
      parseViewerMessage({
        type: "sidecarWrite",
        load: 1,
        op: "upsert",
        highlight: { ...highlight, ...change },
      }),
      undefined,
      JSON.stringify(change).slice(0, 80),
    );
  }
  for (const message of [
    { type: "sidecarWrite", load: -1, op: "delete", id: "hl-x" },
    { type: "sidecarWrite", load: 1, op: "delete", id: "../x" },
    { type: "sidecarWrite", load: 1, op: "rename", id: "hl-x" },
  ]) {
    assert.equal(parseViewerMessage(message), undefined);
  }
});

test("the viewer takes the host's highlights one by one, and null for none kept", () => {
  assert.equal(parseSidecarHighlights(null), null);
  assert.equal(parseSidecarHighlights("x"), undefined);
  assert.deepEqual(
    parseSidecarHighlights([highlight, { ...highlight, page: -1 }]),
    [highlight],
  );
});

test("a selected sidecar highlight reports its id with its region", () => {
  const region = { kind: "region", page: 3, rect: [72, 410, 292, 422] };
  assert.deepEqual(parseSelection({ ...region, highlightId: "hl-a1" }), {
    ...region,
    highlightId: "hl-a1",
  });
  assert.deepEqual(parseSelection({ ...region, highlightId: "a b" }), region);
});
