import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

interface BundleManifest {
  name: string;
  version: string;
  private: boolean;
  type: string;
  main: string;
  icon: string;
  exports: Record<string, string>;
  files: string[];
  dsh: {
    bundle: { patch: string };
    client: {
      platform: string;
      immediately: boolean;
      inject: string[];
    };
  };
}

const templateUrl = new URL("../../scripts/manifest.json", import.meta.url);
const bundleUrl = new URL("../../bundle/", import.meta.url);
const iconUrl = new URL("../../../../media/icon.png", import.meta.url);

function readManifest(): BundleManifest {
  return JSON.parse(readFileSync(templateUrl, "utf8")) as BundleManifest;
}

function readBundleText(relative: string): string {
  return readFileSync(new URL(relative, bundleUrl), "utf8");
}

test("the manifest declares a DSH bundle with both a Host and a Web client half", () => {
  const manifest = readManifest();
  assert.equal(manifest.name, "@lumiere/dsh");
  assert.equal(manifest.private, true);
  assert.equal(manifest.type, "module");
  assert.equal(manifest.main, "index.js");
  assert.equal(manifest.exports["."], "./index.js");
  assert.equal(manifest.exports["./client"], "./client.js");
  assert.equal(manifest.dsh.bundle.patch, "./cordis.patch.yml");
  assert.equal(manifest.dsh.client.platform, "web");
  // The build supplies these; the template must not freeze them.
  assert.equal(manifest.version, "0.0.0");
  assert.equal("repository" in manifest, false);
});

test("the manifest exports and ships the display resources DSH reads", () => {
  const manifest = readManifest();
  assert.equal(manifest.icon, "./icon.png");
  assert.equal(manifest.exports["./icon"], "./icon.png");
  assert.equal(manifest.exports["./locale/*.json"], "./locale/*.json");
  for (const file of [
    "index.js",
    "client.js",
    "cordis.patch.yml",
    "contributed.json",
    "menus.json",
    "commands.json",
    "markdown/",
    "pdf/",
    "page/",
    "locale/*.json",
    "icon.png",
    "README.md",
    "LICENSE",
    "THIRD_PARTY_NOTICES.md",
  ]) {
    assert.ok(manifest.files.includes(file), `files must list ${file}`);
  }
});

test("the client module loads behind DSH's document preview providers", () => {
  const { client } = readManifest().dsh;
  assert.equal(client.immediately, true);
  assert.ok(
    client.inject.includes(
      "@deepseek-ai/dsh-client-ui-sidebar-documentpreview",
    ),
  );
  assert.ok(client.inject.includes("@deepseek-ai/dsh-client-ui-sidebar-right"));
});

test("the patch inserts the Host row under the package's own name", () => {
  const patch = readBundleText("cordis.patch.yml");
  assert.match(patch, /id:\s*lumiere/);
  assert.match(patch, /name:\s*["']@lumiere\/dsh["']/);
  assert.match(patch, /config:\s*\{\}/);
});

test("every locale has a localized title and description", () => {
  const localeUrl = new URL("locale/", bundleUrl);
  const names = readdirSync(localeUrl).filter((name) => name.endsWith(".json"));
  assert.ok(names.includes("en.json"));
  assert.ok(names.includes("zh.json"));
  for (const name of names) {
    const locale = JSON.parse(readBundleText(`locale/${name}`)) as {
      meta?: { title?: string; description?: string };
    };
    assert.ok(locale.meta?.title, `${name} needs meta.title`);
    assert.ok(locale.meta?.description, `${name} needs meta.description`);
  }
});

test("the icon is a small PNG inside the workspace", () => {
  const bytes = readFileSync(iconUrl);
  assert.deepEqual(
    Array.from(bytes.subarray(0, 8)),
    [137, 80, 78, 71, 13, 10, 26, 10],
  );
  assert.ok(statSync(fileURLToPath(iconUrl)).size <= 256 * 1024);
});
