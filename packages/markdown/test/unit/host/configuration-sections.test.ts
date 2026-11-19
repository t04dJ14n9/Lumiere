import test from "node:test";
import assert from "node:assert/strict";
import { watchedSections } from "../../../src/host/configuration-sections";

test("configuration changes are watched only where the plugins read", () => {
  const sections = watchedSections();
  for (const section of [
    "lumiere.markdown",
    "editor.fontWeight",
    "editor.fontFamily",
    "editor.lineNumbers",
    "files.autoSave",
  ]) {
    assert.ok(sections.includes(section), `${section} is watched`);
  }
  // A theme switch or another extension's setting changes nothing we read.
  for (const section of ["workbench", "workbench.colorTheme", "editor"]) {
    assert.ok(!sections.includes(section), `${section} is not watched`);
  }
  assert.ok(sections.every((section) => !section.includes("#")));
});
