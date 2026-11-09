import assert from "node:assert/strict";
import { test } from "node:test";
import { VIEW_COMMAND_IDS } from "../../src/shared/command-ids";
import { parseViewerAction } from "../../src/shared/view-state";
import { shouldDeleteAnnotationOnKey } from "../../src/shared/annotation-delete-keys";
import { pdfContributes } from "./support/manifest";

test("deleteAnnotation command id is stable", () => {
  assert.equal(
    VIEW_COMMAND_IDS.deleteAnnotation,
    "lumiere.pdf.deleteAnnotation",
  );
});

test("parseViewerAction accepts deleteSelectedAnnotations", () => {
  assert.deepEqual(parseViewerAction({ action: "deleteSelectedAnnotations" }), {
    action: "deleteSelectedAnnotations",
  });
});

test("shouldDeleteAnnotationOnKey only in annotate with selection, not editable", () => {
  assert.equal(
    shouldDeleteAnnotationOnKey({
      key: "Delete",
      annotate: true,
      hasAnnotationSelection: true,
      editable: false,
    }),
    true,
  );
  assert.equal(
    shouldDeleteAnnotationOnKey({
      key: "Backspace",
      annotate: true,
      hasAnnotationSelection: true,
      editable: false,
    }),
    true,
  );
  assert.equal(
    shouldDeleteAnnotationOnKey({
      key: "Delete",
      annotate: true,
      hasAnnotationSelection: true,
      editable: true,
    }),
    false,
  );
  // Typing in a free-text box: the key edits its text.
  assert.equal(
    shouldDeleteAnnotationOnKey({
      key: "Backspace",
      annotate: true,
      hasAnnotationSelection: true,
      editable: false,
      editingText: true,
    }),
    false,
  );
  assert.equal(
    shouldDeleteAnnotationOnKey({
      key: "Delete",
      annotate: true,
      hasAnnotationSelection: true,
      editable: false,
      editingText: false,
    }),
    true,
  );
  assert.equal(
    shouldDeleteAnnotationOnKey({
      key: "Delete",
      annotate: false,
      hasAnnotationSelection: true,
      editable: false,
    }),
    false,
  );
  assert.equal(
    shouldDeleteAnnotationOnKey({
      key: "Delete",
      annotate: true,
      hasAnnotationSelection: false,
      editable: false,
    }),
    false,
  );
  assert.equal(
    shouldDeleteAnnotationOnKey({
      key: "a",
      annotate: true,
      hasAnnotationSelection: true,
      editable: false,
    }),
    false,
  );
});

test("webview context contributes Delete for annotate selection", () => {
  const contributes = pdfContributes<{
    commands: { command: string; title: string }[];
    menus: Record<string, { command: string; when?: string; group?: string }[]>;
  }>();
  assert.ok(
    contributes.commands.some(
      (entry) => entry.command === "lumiere.pdf.deleteAnnotation",
    ),
  );
  const entry = contributes.menus["webview/context"]?.find(
    (item) => item.command === "lumiere.pdf.deleteAnnotation",
  );
  assert.ok(entry, "webview/context Delete");
  assert.match(entry?.when ?? "", /webviewId == 'lumiere\.pdf\.viewer'/);
  assert.match(entry?.when ?? "", /lumiere\.pdf\.tool == 'annotate'/);
  assert.match(entry?.when ?? "", /lumiere\.pdf\.hasAnnotationSelection/);
});

test("Delete Annotation enablement requires annotation selection, not any selection", () => {
  const contributes = pdfContributes<{
    commands: { command: string; enablement?: string }[];
    menus: Record<string, { command: string; when?: string }[]>;
  }>();
  const command = contributes.commands.find(
    (entry) => entry.command === "lumiere.pdf.deleteAnnotation",
  );
  assert.ok(command?.enablement);
  assert.match(command!.enablement!, /lumiere\.pdf\.hasAnnotationSelection/);
  assert.doesNotMatch(
    command!.enablement!.replace(/hasAnnotationSelection/g, ""),
    /hasSelection/,
  );
  const entry = contributes.menus["webview/context"]?.find(
    (item) => item.command === "lumiere.pdf.deleteAnnotation",
  );
  assert.ok(entry?.when);
  assert.match(entry!.when!, /lumiere\.pdf\.hasAnnotationSelection/);
  assert.doesNotMatch(
    entry!.when!.replace(/hasAnnotationSelection/g, ""),
    /hasSelection/,
  );
});
