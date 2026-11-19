import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
  capabilities: {
    untrustedWorkspaces: { restrictedConfigurations: string[] };
  };
};

// A folder that is not trusted must not choose where its passages are sent,
// where annotation files are written, or which PDFs may be written into:
// VS Code ignores its value of a restricted setting until it is trusted.
test("settings that send content or choose where files are written are restricted", () => {
  const restricted =
    manifest.capabilities.untrustedWorkspaces.restrictedConfigurations;
  for (const key of [
    "lumiere.markdown.copyLinkForAgent.target",
    "lumiere.pdf.agentBridge.enabled",
    "lumiere.pdf.copyLinkForAgent.target",
    "lumiere.pdf.annotations.folder",
    "lumiere.pdf.annotations.protectedFolders",
  ]) {
    assert.ok(restricted.includes(key), `${key} is restricted`);
  }
});
