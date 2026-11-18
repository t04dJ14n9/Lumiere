import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { after, before, test } from "node:test";
// First: files.ts imports 'vscode', which this points at the fake.
import "./support/install-fake-vscode";
import * as fake from "./support/fake-vscode";
import { vscodePdfFiles } from "../../src/extension/plugins/pdf/files";

let vault: string;
before(async () => {
  vault = await mkdtemp(path.join(os.tmpdir(), "lumiere-protected-"));
  // The fake has no workspace folders: the vault is the one folder here.
  Object.assign(fake.workspace, {
    getWorkspaceFolder: () => ({ uri: fake.Uri.file(vault) }),
    asRelativePath: (uri: fake.Uri) => path.relative(vault, uri.fsPath),
  });
});
after(() => rm(vault, { recursive: true, force: true }));

async function pdfAt(relative: string): Promise<string> {
  const file = path.join(vault, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, "%PDF-original");
  return `file://${file}`;
}

test("the host refuses to write a PDF in a protected folder, whoever asks", async () => {
  const uri = await pdfAt(".raw/paper.pdf");
  await assert.rejects(
    vscodePdfFiles.writeAtomic!(uri, new TextEncoder().encode("%PDF-new")),
    /protected folder/u,
  );
  assert.equal(
    await readFile(path.join(vault, ".raw/paper.pdf"), "utf8"),
    "%PDF-original",
  );
});

test("the protected folders come from lumiere.pdf.annotations.protectedFolders", async () => {
  const key = ".lumiere.pdf.annotations.protectedFolders";
  fake.configuration.set(key, ["sources"]);
  try {
    const inbox = await pdfAt("inbox/paper.pdf");
    await vscodePdfFiles.writeAtomic!(
      inbox,
      new TextEncoder().encode("%PDF-a"),
    );
    assert.equal(
      await readFile(path.join(vault, "inbox/paper.pdf"), "utf8"),
      "%PDF-a",
    );
    const source = await pdfAt("sources/paper.pdf");
    await assert.rejects(
      vscodePdfFiles.writeAtomic!(source, new TextEncoder().encode("%PDF-b")),
      /protected folder/u,
    );
  } finally {
    fake.configuration.delete(key);
  }
});
