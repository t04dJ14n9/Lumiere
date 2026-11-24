import test from "node:test";
import assert from "node:assert/strict";
import { VaultConfigs } from "../../../src/plugins/obsidianCompat/vault-configs";
import type { ConfigFiles } from "../../../src/plugins/obsidianCompat/config-files";
import type { Vault } from "../../../src/plugins/vault/api";
import { MemoryVaultIndex } from "../../../src/plugins/vault/memory-index";

const REMOTE_ROOT = "vscode-remote://ssh/vault";

/** Config files of a vault that has no `.obsidian` folder. */
const emptyFiles: ConfigFiles = {
  async read() {
    return undefined;
  },
  async writeTypes() {},
  watch: () => () => {},
};

/** Records every vault lookup and every configuration folder it reads. */
function harness() {
  const lookups: string[] = [];
  const directories: string[] = [];
  const configs = new VaultConfigs({
    vaults: {
      forDocument: async (uri) => {
        lookups.push(uri);
        const index = new MemoryVaultIndex({
          root: REMOTE_ROOT,
          folderNote: "",
          linkFormat: "shortest",
        });
        return { index } as unknown as Vault;
      },
    },
    configFolder: () => ".obsidian",
    files: (_root, directory) => {
      directories.push(directory);
      return emptyFiles;
    },
    changed() {},
    warn() {},
  });
  return { configs, lookups, directories };
}

test("an untitled note reads no vault configuration and does not fail", async () => {
  const { configs, lookups, directories } = harness();
  const documentUri = "untitled:Untitled-1";

  await configs.prepare(documentUri);

  assert.deepEqual(await configs.getObsidianOverrides({ documentUri }), {});
  assert.deepEqual(lookups, []);
  assert.deepEqual(directories, []);
});

test("a note in a remote workspace still reads its vault configuration", async () => {
  const { configs, directories } = harness();

  await configs.getObsidianOverrides({
    documentUri: `${REMOTE_ROOT}/Note.md`,
  });

  assert.deepEqual(directories, [`${REMOTE_ROOT}/.obsidian`]);
});
