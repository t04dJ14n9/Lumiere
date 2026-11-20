import test from "node:test";
import assert from "node:assert/strict";
import type { DragFile } from "../../../src/attachments";
import {
  saveDropped,
  type DropSaver,
} from "../../../src/plugins/attachments/drop-save";
import { refusalMessage } from "../../../src/plugins/attachments/host";
import { MAX_ATTACHMENT_BYTES } from "../../../src/plugins/attachments/protocol";

function file(name: string, size: number, read = true): DragFile {
  let reads = 0;
  return {
    name,
    type: "image/png",
    size,
    async arrayBuffer() {
      reads++;
      if (!read) {
        throw new Error("The file is gone");
      }
      return new Uint8Array(Math.min(size, 4)).buffer;
    },
    get reads() {
      return reads;
    },
  } as DragFile;
}

function recordingSaver(failing: string[] = []) {
  const refused: string[] = [];
  const failed: unknown[] = [];
  let count = 0;
  const saver: DropSaver = {
    async saveBytes(_bytes, ext) {
      count++;
      return `![[saved ${count}.${ext}]]`;
    },
    async saveSource(uri) {
      if (failing.includes(uri)) {
        throw new Error("RPC timed out");
      }
      return `![[${uri}]]`;
    },
    refuse: (name, reason) => refused.push(`${name}: ${reason}`),
    failed: (error) => failed.push(error),
  };
  return { saver, refused, failed };
}

test("a dropped file too large to send is refused unread, and the rest are saved", async () => {
  const { saver, refused, failed } = recordingSaver(["https://ex.com/b.png"]);
  const large = file("huge.png", MAX_ATTACHMENT_BYTES + 1);
  const embeds = await saveDropped(
    saver,
    [file("a.png", 10), large, file("gone.png", 10, false), file("c.png", 10)],
    ["https://ex.com/b.png", "https://ex.com/d.png"],
  );
  assert.deepEqual(embeds, [
    "![[saved 1.png]]",
    "![[saved 2.png]]",
    "![[https://ex.com/d.png]]",
  ]);
  assert.deepEqual(refused, ["huge.png: tooLarge", "gone.png: unreadable"]);
  assert.equal((large as unknown as { reads: number }).reads, 0);
  assert.equal(failed.length, 1);
});

test("the host says why a dropped file was not added", () => {
  assert.equal(
    refusalMessage("huge.png", "tooLarge"),
    "“huge.png” is larger than 15 MB, so it was not added to the note.",
  );
  assert.match(refusalMessage("gone.png", "unreadable"), /could not be read/);
});
