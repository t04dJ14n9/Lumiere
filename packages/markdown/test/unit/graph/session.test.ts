import test from "node:test";
import assert from "node:assert/strict";
import { protocol } from "../../../src/plugins/graph/protocol";
import { VIEW, graphFixture, tick } from "./fixture";

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

test("a click on the drawn graph opens its note while a refresh waits for the vault", async (t) => {
  const fixture = await graphFixture(NOTES);
  t.after(() => fixture.root.dispose());
  const opened = await fixture.open();
  await opened.page.call(protocol, "ready", VIEW);
  await settle();
  const drawn = opened.snapshots.at(-1)!;
  assert.ok(drawn.nodes.length > 0);
  // The vault is busy: the refresh the view change asks for is not sent yet.
  let finishIndexing = () => {};
  const vault = fixture.memory.vaults.all()[0]!;
  const indexing = new Promise<void>((resolve) => {
    finishIndexing = resolve;
  });
  vault.settled = () => indexing;
  t.after(() => finishIndexing());
  await opened.page.call(protocol, "view", { ...VIEW, depth: 3 });
  await settle();
  assert.equal(opened.snapshots.at(-1), drawn);

  const result = await opened.page.call(protocol, "open", {
    scopeId: drawn.scopeId,
    nodeId: drawn.nodes[0]!.id,
    generation: drawn.generation,
  });
  assert.deepEqual(result, { opened: true });
  assert.equal(fixture.memory.opened.length, 1);

  finishIndexing();
  await settle();
  const refreshed = opened.snapshots.at(-1)!;
  assert.ok(refreshed.generation > drawn.generation);
  assert.deepEqual(
    await opened.page.call(protocol, "open", {
      scopeId: drawn.scopeId,
      nodeId: drawn.nodes[0]!.id,
      generation: drawn.generation,
    }),
    { opened: false },
    "once the new drawing is sent, the old one's clicks are refused",
  );
});
