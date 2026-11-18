import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

/** What is left of the annotation commands in the palette: no mode, no pickers. */
const PALETTE_COMMANDS = [
  "lumiere.pdf.highlightSelection",
  "lumiere.pdf.underlineSelection",
  "lumiere.pdf.annotationUndo",
  "lumiere.pdf.annotationRedo",
  "lumiere.pdf.annotationRetrySave",
] as const;

function source(relativePath: string): string {
  return readFileSync(join(root, relativePath), "utf8");
}

test("the viewer does not mount an in-viewer annotation bar", () => {
  const viewer = source("src/webview/viewer.tsx");
  assert.doesNotMatch(viewer, /AnnotationChromeBar/);
  assert.doesNotMatch(viewer, /annotation-chrome-bar/);
  assert.doesNotMatch(viewer, /AnnotationToolkit/);
  assert.equal(
    existsSync(join(root, "src/webview/annotation-toolbar.tsx")),
    false,
  );
});

test("the slim bar does not mount an Annotate control", () => {
  const toolbar = source("src/webview/toolbar.tsx");
  assert.doesNotMatch(toolbar, /AnnotationToolkit/);
  assert.doesNotMatch(toolbar, /label="Annotate"/);
});

test("styles do not reserve a row or strip for an in-viewer annotation bar", () => {
  const base = source("src/webview/styles/base.css");
  const toolbar = source("src/webview/styles/toolbar.css");
  assert.doesNotMatch(base, /tool-annotate:not\(\.toolbar-slim\)/);
  assert.doesNotMatch(base, /annotation-chrome-bar/);
  assert.doesNotMatch(toolbar, /annotation-chrome-bar/);
  assert.doesNotMatch(toolbar, /annotation-toolkit/);
  assert.doesNotMatch(toolbar, /\.color-chip/);
});

test("annotations have no status bar entry; the palette and a shortcut mark selected text", () => {
  const bar = source("src/extension/plugins/pdfToolbar/status-bar.ts");
  assert.doesNotMatch(bar, /id: "annotat/u);
  assert.equal(
    existsSync(
      join(root, "src/extension/plugins/pdfToolbar/annotation-picker.ts"),
    ),
    false,
  );

  const contributes = JSON.parse(source("contributes.json")) as {
    menus: Record<string, { command: string }[]>;
    keybindings: { command: string; key: string; mac?: string }[];
  };
  const title = new Set(
    (contributes.menus["editor/title"] ?? []).map((entry) => entry.command),
  );
  const palette = new Set(
    (contributes.menus.commandPalette ?? []).map((entry) => entry.command),
  );
  for (const id of PALETTE_COMMANDS) {
    assert.equal(title.has(id), false, id);
    assert.equal(palette.has(id), true, id);
  }
  // As in macOS Preview: ⌃⌘H highlights, ⌃⌘U underlines, ⌃⌘S strikes out.
  // Plain ⌘H stays the system's Hide.
  const keys = Object.fromEntries(
    contributes.keybindings
      .filter((entry) => /Selection$/u.test(entry.command))
      .map((entry) => [entry.command, [entry.key, entry.mac]]),
  );
  assert.deepEqual(keys, {
    "lumiere.pdf.highlightSelection": ["ctrl+alt+h", "ctrl+cmd+h"],
    "lumiere.pdf.underlineSelection": ["ctrl+alt+u", "ctrl+cmd+u"],
    "lumiere.pdf.strikeoutSelection": ["ctrl+alt+s", "ctrl+cmd+s"],
  });
  assert.equal(
    contributes.keybindings.some(
      (entry) => entry.key === "ctrl+alt+a" || entry.mac === "cmd+h",
    ),
    false,
  );
  assert.equal(
    contributes.keybindings.some(
      (entry) =>
        (entry.key === "ctrl+z" || entry.mac === "cmd+z") &&
        entry.command.startsWith("lumiere.pdf.annotation"),
    ),
    false,
  );
});
