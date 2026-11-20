import test from "node:test";
import assert from "node:assert/strict";
import { metadata } from "../../../src/markdown/metadata";
import { BaseSnapshots } from "../../../src/plugins/resources/base-snapshot";
import { PageBaseSnapshot } from "../../../src/plugins/resources/page-base-snapshot";
import type { Resource } from "../../../src/plugins/resources/api";
import { MemoryVaultIndex } from "../../../src/plugins/vault/memory-index";

const root = "file:///vault";

function vault(notes: Record<string, string>) {
  const index = new MemoryVaultIndex({
    root,
    folderNote: "",
    linkFormat: "shortest",
  });
  index.replaceFiles(
    Object.keys(notes).map((path) => ({
      uri: `${root}/${path}`,
      path,
      mtime: 1,
      size: 1,
    })),
  );
  for (const [path, text] of Object.entries(notes)) {
    index.setMetadata(path, metadata(text));
  }
  return index;
}

/** A page's copy of the panel's snapshot, as it would receive one reply. */
function base(reply: ReturnType<BaseSnapshots["reply"]>): Resource {
  return { kind: "base", source: `${root}/Data.base`, url: "u", ...reply };
}

test("a panel's base embeds share one snapshot: the page holds it, the host sends it once", () => {
  const index = vault({ "A.md": "[[B]] #x", "B.md": "", "C.md": "" });
  const snapshots = new BaseSnapshots(index);
  let builds = 0;
  const build = snapshots["build"].bind(snapshots);
  snapshots["build"] = () => {
    builds++;
    return build();
  };
  const page = new PageBaseSnapshot();

  const first = page.take(base(snapshots.reply("A.md", page.have)));
  assert.deepEqual(
    first.entries?.map((entry) => entry.path),
    ["A.md", "B.md", "C.md"],
  );
  assert.equal(first.thisEntry?.path, "A.md");
  // Every other embed of the panel: no entries cross, none are built.
  const again = snapshots.reply("A.md", page.have);
  assert.equal(again.entries, undefined);
  assert.equal(again.changed, undefined);
  assert.deepEqual(page.take(base(again)).entries, first.entries);
  assert.equal(builds, 1);
});

test("after a vault change only the entries that changed cross", () => {
  const index = vault({ "A.md": "[[B]]", "B.md": "", "C.md": "" });
  const snapshots = new BaseSnapshots(index);
  index.onDidChange(() => snapshots.invalidate());
  const page = new PageBaseSnapshot();
  page.take(base(snapshots.reply(undefined, page.have)));

  index.setMetadata("C.md", metadata("[[B]] #new"));
  const reply = snapshots.reply(undefined, page.have);
  assert.equal(reply.entries, undefined);
  // C links to B now: C's links and tags, and B's backlinks, changed.
  assert.deepEqual(
    reply.changed?.map((entry) => entry.path),
    ["B.md", "C.md"],
  );
  const entries = page.take(base(reply)).entries!;
  assert.deepEqual(
    entries.map((entry) => [entry.path, entry.backlinks, entry.tags]),
    [
      ["A.md", [], []],
      ["B.md", ["A.md", "C.md"], []],
      ["C.md", [], ["#new"]],
    ],
  );

  // A page that holds no copy, or an older one, gets the whole snapshot.
  assert.equal(snapshots.reply(undefined, undefined).entries?.length, 3);
  assert.equal(snapshots.reply(undefined, -1).entries?.length, 3);
});

test("a note added or removed sends the whole snapshot again", () => {
  const index = vault({ "A.md": "", "B.md": "" });
  const snapshots = new BaseSnapshots(index);
  index.onDidChange(() => snapshots.invalidate());
  const page = new PageBaseSnapshot();
  page.take(base(snapshots.reply(undefined, page.have)));
  index.upsertFile({ uri: `${root}/D.md`, path: "D.md", mtime: 2, size: 2 });
  const reply = snapshots.reply(undefined, page.have);
  assert.deepEqual(
    reply.entries?.map((entry) => entry.path),
    ["A.md", "B.md", "D.md"],
  );
});

test("a late reply for an older snapshot does not take the page's copy back", () => {
  const index = vault({ "A.md": "", "B.md": "" });
  const snapshots = new BaseSnapshots(index);
  index.onDidChange(() => snapshots.invalidate());
  const page = new PageBaseSnapshot();
  const old = snapshots.reply(undefined, undefined);
  index.setMetadata("A.md", metadata("#t"));
  page.take(base(snapshots.reply(undefined, undefined)));
  const newer = page.have;
  const late = page.take(base(old));
  assert.equal(page.have, newer);
  assert.deepEqual(late.entries?.[0]?.tags, ["#t"]);
  const current = page.take(base(snapshots.reply(undefined, page.have)));
  assert.deepEqual(current.entries?.[0]?.tags, ["#t"]);
});
