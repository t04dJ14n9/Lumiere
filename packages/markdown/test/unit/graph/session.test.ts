import test from "node:test";
import assert from "node:assert/strict";
import { graphFixture, tick } from "./fixture";

const NOTES = { "A.md": "[[B]]\n", "B.md": "# B\n" };

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await tick();
  }
}

test("closing the graph panel releases what the host listened to on it", async (t) => {
  const fixture = await graphFixture(NOTES);
  t.after(() => fixture.root.dispose());
  for (let round = 0; round < 3; round++) {
    const opened = await fixture.open();
    await settle();
    assert.ok(opened.listeners() > 0, "an open panel is listened to");
    opened.panel.dispose();
    await settle();
    assert.equal(
      opened.listeners(),
      0,
      `round ${round}: a closed panel keeps no listeners until the plugin stops`,
    );
  }
});
