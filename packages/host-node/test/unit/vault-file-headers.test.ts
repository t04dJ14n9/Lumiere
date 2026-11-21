import test from "node:test";
import assert from "node:assert/strict";
import { mediaExtensions } from "../../../markdown/src/shared/media-kinds";
import {
  VAULT_FILE_POLICY,
  vaultFileHeaders,
  vaultMediaType,
} from "../../src/vault-file-headers";

test("vault files: every image, audio and video kind the editor embeds keeps its media type", () => {
  for (const [kind, extensions] of Object.entries(mediaExtensions)) {
    for (const extension of extensions) {
      const type = vaultMediaType(`/vault/clip.${extension}`);
      assert.ok(type?.startsWith(`${kind}/`), `${extension}: ${type}`);
    }
  }
  assert.equal(vaultMediaType("/vault/paper.PDF"), "application/pdf");
});

test("vault files: the type is read from the file's own name, with either separator", () => {
  assert.equal(vaultMediaType("C:\\vault\\shot.png"), "image/png");
  assert.equal(vaultMediaType("/vault/a.png/readme"), undefined);
  assert.equal(vaultMediaType("C:\\va.png\\readme"), undefined);
  assert.equal(vaultMediaType("/vault/png"), undefined);
  assert.equal(vaultMediaType("/vault/archive.tar.gz"), undefined);
});

test("vault files: what the editor does not embed is bytes to save, never a page or a script", () => {
  for (const name of [
    "page.html",
    "page.htm",
    "page.xhtml",
    "feed.xml",
    "tool.js",
    "tool.mjs",
    "style.css",
    "data.json",
    "module.wasm",
    "README",
  ]) {
    const headers = vaultFileHeaders(`/vault/${name}`);
    assert.equal(headers["content-type"], "application/octet-stream", name);
    assert.equal(headers["content-disposition"], "attachment", name);
    assert.equal(headers["x-content-type-options"], "nosniff", name);
    assert.equal(headers["content-security-policy"], VAULT_FILE_POLICY, name);
  }
});

test("vault files: an image or a video shows as itself, sandboxed if opened as a page", () => {
  const shown: readonly (readonly [string, string])[] = [
    ["drawing.svg", "image/svg+xml"],
    ["photo.JPG", "image/jpeg"],
    ["clip.webm", "video/webm"],
    ["voice.m4a", "audio/mp4"],
  ];
  for (const [name, type] of shown) {
    const headers = vaultFileHeaders(`/vault/${name}`);
    assert.equal(headers["content-type"], type, name);
    assert.equal(headers["content-disposition"], undefined, name);
    assert.equal(headers["x-content-type-options"], "nosniff", name);
    assert.equal(headers["content-security-policy"], VAULT_FILE_POLICY, name);
  }
  assert.equal(VAULT_FILE_POLICY, "default-src 'none'; sandbox");
});

test("vault files: a PDF is not sandboxed, which Chrome would refuse to show", () => {
  const headers = vaultFileHeaders("/vault/paper.pdf");
  assert.equal(headers["content-type"], "application/pdf");
  assert.equal(headers["content-security-policy"], undefined);
  assert.equal(headers["content-disposition"], undefined);
  assert.equal(headers["x-content-type-options"], "nosniff");
});
