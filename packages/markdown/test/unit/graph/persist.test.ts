import test from "node:test";
import assert from "node:assert/strict";
import { readPersisted } from "../../../src/webview/graph/persist";

test("a saved graph keeps Show orphans off; an old orphans-only panel gets the default", () => {
  assert.equal(
    readPersisted({ filters: { showOrphans: false } }).filters.showOrphans,
    false,
  );
  // `orphans: true` used to mean "only orphans"; it has no new equivalent.
  assert.equal(
    readPersisted({ filters: { orphans: true } }).filters.showOrphans,
    true,
  );
  assert.equal(readPersisted(undefined).filters.showOrphans, true);
});
