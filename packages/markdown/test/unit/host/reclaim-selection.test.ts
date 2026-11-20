import test from "node:test";
import assert from "node:assert/strict";
import { shouldTransferSelection } from "../../../src/host/reclaim-selection";

// Every command-driven selection change in any text editor asks; reading the
// selection copies and splits the whole document, so a file that is not a
// reclaimed note must be ruled out before it is read.
test("a selection change outside a reclaimed note never reads the document", () => {
  let reads = 0;
  const hasTarget = () => {
    reads++;
    return true;
  };
  assert.equal(
    shouldTransferSelection(() => false, hasTarget),
    false,
  );
  assert.equal(reads, 0);
  assert.equal(
    shouldTransferSelection(() => true, hasTarget),
    true,
  );
  assert.equal(reads, 1);
  assert.equal(
    shouldTransferSelection(
      () => true,
      () => false,
    ),
    false,
  );
});
