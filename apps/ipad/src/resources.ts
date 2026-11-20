/**
 * Where the web view reads a vault file a note shows (an image, a video, an
 * embedded PDF): `_lumiere/vault/<vault id>/<path>`, which the app's router
 * answers from the vault's folder (VaultRouter.swift). A file outside the
 * iPad's vaults has no such address.
 */
import { uriPath } from "@workshop/host-node/core";
import { SVG_IMAGE_MARK } from "@workshop/host-node/embedding";

/**
 * `vaults` maps each vault's id to the folder host-web mounts it at
 * (`/vaults/<name>`); `base` is the app's own address.
 */
export function vaultFileUrl(
  uri: string,
  vaults: ReadonlyMap<string, string>,
  base: URL | string,
): string | undefined {
  let path: string;
  try {
    path = uriPath(uri);
  } catch {
    return undefined;
  }
  for (const [id, folder] of vaults) {
    if (path.startsWith(`${folder}/`)) {
      const inside = path.slice(folder.length + 1);
      return /\.svg$/i.test(inside)
        ? svgAddress(id, inside, base)
        : vaultAddress(id, inside, base);
    }
  }
  return undefined;
}

/**
 * Where the router serves an SVG's bytes as plain text (`.txt`), so that
 * no link or frame runs its script on the app's origin, which has no
 * sandbox header to give it; the note's page shows it from a `data:` URL
 * (`SVG_IMAGE_MARK`, host-node's page/svg-images.ts).
 */
export function svgAddress(
  id: string,
  path: string,
  base: URL | string,
): string {
  const relative = path.split("/").map(encodeURIComponent).join("/");
  const address = new URL(
    `_lumiere/vault-svg/${encodeURIComponent(id)}/${relative}.txt`,
    base,
  ).href;
  return address + SVG_IMAGE_MARK;
}

/** Where the router serves `path` (inside the vault, with "/") of vault `id`. */
export function vaultAddress(
  id: string,
  path: string,
  base: URL | string,
): string {
  const relative = path.split("/").map(encodeURIComponent).join("/");
  return new URL(`_lumiere/vault/${encodeURIComponent(id)}/${relative}`, base)
    .href;
}
