import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPdfIdeContextPacket,
  buildPdfIdeContextPacketWithRegion,
  mapPdfSelectionWire,
  viewedPages,
} from "../../src/extension/plugins/ideContext/adapter";
import { DEFAULT_CAPS } from "@workshop/agents/ide-context";

test("no selection → pdf.selection kind none", () => {
  const packet = buildPdfIdeContextPacket({
    uri: "file:///a.pdf",
    selection: null,
    host: {
      listTabs: () => ({ visible: ["file:///a.pdf"], open: [] }),
      getDiagnostics: () => [],
    },
  });
  assert.equal(packet.product, "pdfWorkshop");
  assert.equal(packet.pdf.selection.kind, "none");
  assert.equal(packet.active?.uri, "file:///a.pdf");
  assert.equal(packet.active?.selection, undefined);
  assert.equal(packet.markdown, undefined);
});

test("the packet says which page is shown and how many the PDF has", () => {
  const packet = buildPdfIdeContextPacket({
    uri: "file:///a.pdf",
    selection: null,
    ...viewedPages({ page: 3, pageCount: 12 }),
    host: {
      listTabs: () => ({ visible: ["file:///a.pdf"], open: [] }),
      getDiagnostics: () => [],
    },
  });
  assert.equal(packet.pdf?.page, 3);
  assert.equal(packet.pdf?.pageCount, 12);
  assert.deepEqual(viewedPages(undefined), {});
});

test("text selection maps to pdf.selection text with rects; not active.selection", () => {
  const packet = buildPdfIdeContextPacket({
    uri: "file:///a.pdf",
    selection: {
      kind: "text",
      text: "hello",
      pages: [{ page: 1, rects: [[0, 0, 10, 10]] }],
    },
    host: {
      listTabs: () => ({ visible: ["file:///a.pdf"], open: [] }),
      getDiagnostics: () => [],
    },
    caps: DEFAULT_CAPS,
  });
  assert.equal(packet.product, "pdfWorkshop");
  assert.equal(packet.pdf.selection.kind, "text");
  if (packet.pdf.selection.kind === "text") {
    assert.equal(packet.pdf.selection.text, "hello");
    assert.deepEqual(packet.pdf.selection.rects?.[0], {
      page: 1,
      x: 0,
      y: 0,
      w: 10,
      h: 10,
    });
  }
  assert.equal(packet.active?.selection, undefined);
});

test("region selection maps to pdf.selection region rects", () => {
  const wire = mapPdfSelectionWire(
    { kind: "region", page: 2, rect: [1, 2, 4, 6] },
    "/tmp/snap.png",
  );
  assert.equal(wire.kind, "region");
  if (wire.kind === "region") {
    assert.deepEqual(wire.rects[0], { page: 2, x: 1, y: 2, w: 3, h: 4 });
    assert.equal(wire.regionImagePath, "/tmp/snap.png");
  }
});

test("active.uri === pdf.uri", () => {
  const packet = buildPdfIdeContextPacket({
    uri: "file:///doc.pdf",
    selection: undefined,
    host: {
      listTabs: () => ({ visible: [], open: [] }),
      getDiagnostics: () => [],
    },
  });
  assert.equal(packet.product, "pdfWorkshop");
  assert.equal(packet.active?.uri, packet.pdf.uri);
});

test("a region's snapshot is saved to the region image cache and named in the packet", async () => {
  const host = {
    listTabs: () => ({ visible: ["file:///a.pdf"], open: [] }),
    getDiagnostics: () => [],
  };
  let saves = 0;
  const save = async () => {
    saves++;
    return "/storage/regions/a-2.png";
  };
  const region = await buildPdfIdeContextPacketWithRegion(
    {
      uri: "file:///a.pdf",
      selection: { kind: "region", page: 2, rect: [1, 2, 4, 6] },
      host,
    },
    save,
  );
  assert.equal(region.pdf?.selection.kind, "region");
  if (region.pdf?.selection.kind === "region") {
    assert.equal(
      region.pdf.selection.regionImagePath,
      "/storage/regions/a-2.png",
    );
  }
  // Text has no snapshot to save; with no cache, a region has no path.
  const text = await buildPdfIdeContextPacketWithRegion(
    {
      uri: "file:///a.pdf",
      selection: { kind: "text", text: "x", pages: [] },
      host,
    },
    save,
  );
  assert.equal(text.pdf?.selection.kind, "text");
  assert.equal(saves, 1);
  const uncached = await buildPdfIdeContextPacketWithRegion(
    {
      uri: "file:///a.pdf",
      selection: { kind: "region", page: 2, rect: [1, 2, 4, 6] },
      host,
    },
    undefined,
  );
  assert.equal(
    uncached.pdf?.selection.kind === "region" &&
      uncached.pdf.selection.regionImagePath,
    undefined,
  );
});
