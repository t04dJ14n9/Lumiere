import test from "node:test";
import assert from "node:assert/strict";
import { saveAttachment } from "../../../src/attachments";
import type { WorkspaceFiles } from "../../../src/shared/workspace-files";

const ROOT = "file:///vault";
const FOLDER = `${ROOT}/assets`;
const TAKEN = `${FOLDER}/2026-10-30%2014.52.png`;

/**
 * A folder whose listing misses a file that is there: another writer made
 * it after the listing, or the listing could not be read.
 */
function staleFolder(existing: Record<string, string>) {
  const files = new Map<string, string>(Object.entries(existing));
  const replace = async (uri: string, contents: string) => {
    files.set(uri, contents);
  };
  const create = async (uri: string, contents: string) => {
    if (files.has(uri)) {
      return false;
    }
    files.set(uri, contents);
    return true;
  };
  const api: Pick<
    WorkspaceFiles,
    | "list"
    | "mkdir"
    | "writeText"
    | "writeBytes"
    | "createText"
    | "createBytes"
    | "isSymbolicLink"
  > = {
    list: async () => [],
    mkdir: async () => {},
    writeText: replace,
    writeBytes: (uri, data) => replace(uri, new TextDecoder().decode(data)),
    createText: create,
    createBytes: (uri, data) => create(uri, new TextDecoder().decode(data)),
    isSymbolicLink: async () => false,
  };
  return { files, api };
}

const input = {
  root: ROOT,
  notePath: "Notes/A.md",
  attachmentFolder: "assets",
  useWikilinks: true,
  format: "shortest" as const,
  ext: "png",
  now: new Date(2026, 9, 30, 14, 52),
  vaultPaths: [],
};

test("saveAttachment never overwrites a file its listing missed", async () => {
  const folder = staleFolder({ [TAKEN]: "existing image" });
  const saved = await saveAttachment({
    ...input,
    files: folder.api,
    bytes: new TextEncoder().encode("new image"),
  });
  assert.equal(folder.files.get(TAKEN), "existing image");
  assert.equal(saved?.path, "assets/2026-10-30 14.52 2.png");
  assert.equal(
    folder.files.get(`${FOLDER}/2026-10-30%2014.52%202.png`),
    "new image",
  );
});

test("saveAttachment creates text attachments without overwriting either", async () => {
  const taken = `${FOLDER}/2026-10-30%2014.52.sketch.svg`;
  const folder = staleFolder({ [taken]: "<svg>old</svg>" });
  const saved = await saveAttachment({
    ...input,
    ext: "sketch.svg",
    files: folder.api,
    text: "<svg>new</svg>",
  });
  assert.equal(folder.files.get(taken), "<svg>old</svg>");
  assert.equal(saved?.path, "assets/2026-10-30 14.52 2.sketch.svg");
});

test("saveAttachment gives a named download the next free name on conflict", async () => {
  const taken = `${FOLDER}/photo.png`;
  const folder = staleFolder({ [taken]: "first photo" });
  const saved = await saveAttachment({
    ...input,
    stem: "photo",
    files: folder.api,
    bytes: new TextEncoder().encode("second photo"),
  });
  assert.equal(folder.files.get(taken), "first photo");
  assert.equal(saved?.path, "assets/photo 1.png");
});
