import assert from "node:assert/strict";
import { test } from "node:test";
import {
  annotationLoadState,
  rememberAnnotationLoad,
  settlePdfWrite,
} from "../../src/webview/annotation-load-state";

const A = "a".repeat(64);
const B = "b".repeat(64);

test("a PDF write's result settles its write and files later saves under the written hash", () => {
  rememberAnnotationLoad(2, A);
  assert.deepEqual(settlePdfWrite({ load: 2, write: 5, ok: true, sha256: B }), {
    write: 5,
    ok: true,
  });
  assert.equal(annotationLoadState()?.sha256, B);
  assert.deepEqual(
    settlePdfWrite({ load: 2, write: 6, ok: false, reason: "error" }),
    { write: 6, ok: false },
  );
  // A conflict is settled later, by Keep mine's result for the same write.
  assert.equal(
    settlePdfWrite({ load: 2, write: 7, ok: false, reason: "conflict" }),
    undefined,
  );
});

test("a PDF write's result for an earlier load changes nothing", () => {
  rememberAnnotationLoad(2, A);
  assert.equal(
    settlePdfWrite({ load: 1, write: 1, ok: true, sha256: B }),
    undefined,
  );
  assert.equal(annotationLoadState()?.sha256, A);
});
