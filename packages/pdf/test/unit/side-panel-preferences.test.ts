import assert from "node:assert/strict";
import { test } from "node:test";
import { PdfViewPreferences } from "../../src/host/viewer/preferences";
import type { PdfConfiguration, PdfState } from "../../src/shared/host";

/** Settings and state in memory, and the way to change a setting as VS Code would announce it. */
function open(settings: Record<string, unknown> = {}) {
  const values = new Map<string, unknown>();
  const listeners = new Set<(affects: (section: string) => boolean) => void>();
  const configuration: PdfConfiguration = {
    get: (key) => settings[key],
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const state: PdfState = {
    get: (key) => values.get(key),
    update: async (key, value) => {
      values.set(key, value);
    },
  };
  const told: { uri: string; settings: unknown }[] = [];
  const preferences = new PdfViewPreferences(configuration, state, {
    all: [
      {
        fileUri: "file:///a.pdf",
        setViewSettings: (value: unknown) =>
          told.push({ uri: "file:///a.pdf", settings: value }),
      } as never,
    ],
  });
  return {
    preferences,
    values,
    told,
    change: (key: string, value: unknown) => {
      settings[key] = value;
      for (const listener of [...listeners]) {
        listener((section) => key === section || key.startsWith(`${section}.`));
      }
    },
  };
}

test("the last side panel state the reader chose is kept for the next editor", () => {
  const { preferences, values } = open();
  assert.equal(preferences.sidePanel(), undefined);
  preferences.saveSidePanel({ open: true, width: 310, tab: "annotations" });
  assert.deepEqual(preferences.sidePanel(), {
    open: true,
    width: 310,
    tab: "annotations",
  });
  // One entry for every PDF, not one per file.
  assert.deepEqual([...values.keys()], ["lumiere.pdf.sidePanel"]);
});

test("a saved state that is not one is ignored, and one with missing parts is mended", () => {
  const { preferences, values } = open();
  values.set("lumiere.pdf.sidePanel", "open");
  assert.equal(preferences.sidePanel(), undefined);
  values.set("lumiere.pdf.sidePanel", { open: true, width: 100000 });
  assert.deepEqual(preferences.sidePanel(), {
    open: true,
    width: 640,
    tab: "outline",
  });
});

test("the side panel's outline follows the cursor unless the Explorer's setting is off", () => {
  assert.equal(
    open().preferences.settings("file:///a.pdf").outlineFollowCursor,
    true,
  );
  assert.equal(
    open({ "lumiere.pdf.outline.followCursor": false }).preferences.settings(
      "file:///a.pdf",
    ).outlineFollowCursor,
    false,
  );
});

test("changing Follow Cursor tells every open viewer its new settings", () => {
  const { change, told } = open();
  change("lumiere.pdf.outline.followCursor", false);
  assert.equal(told.length, 1);
  assert.equal(
    (told[0]!.settings as { outlineFollowCursor: boolean }).outlineFollowCursor,
    false,
  );
  change("lumiere.pdf.somethingElse", 1);
  assert.equal(told.length, 1);
});
