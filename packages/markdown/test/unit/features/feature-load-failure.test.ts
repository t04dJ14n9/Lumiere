import test from "node:test";
import assert from "node:assert/strict";
import { createRoot, type Plugin } from "@workshop/core";
import { featureController } from "../../../src/webview/features";

// Each feature is its own chunk. A chunk that fails to load (a dropped
// request) must cost that feature only, not every feature of the editor.
test("a feature whose chunk fails to load leaves the others running", async () => {
  const errors: string[] = [];
  const root = createRoot({
    logger: {
      debug() {},
      warn() {},
      error: (message) => errors.push(message),
    },
  });
  const started: string[] = [];
  const plugin = (name: string): Plugin<unknown> => ({
    name,
    apply() {
      started.push(name);
    },
  });
  const configure = featureController(root, async (id) => {
    if (id === "tables") {
      throw new Error("Failed to fetch dynamically imported module");
    }
    return plugin(id);
  });

  await configure({
    tables: { enabled: true, config: {} },
    tags: { enabled: true, config: {} },
  });

  assert.deepEqual(started, ["tags"]);
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /The tables feature could not be loaded/);
  await root.dispose();
});
