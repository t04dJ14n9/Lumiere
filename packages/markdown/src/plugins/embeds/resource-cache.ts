import type { Resource, Resources } from "../resources/api";

/**
 * What embeds resolved, per `resources` service, so that a block rendered
 * again shows its files at once.
 */
const EMBED_CACHE_LIMIT = 256;
const embedResourceCaches = new WeakMap<Resources, Map<string, Resource>>();

/**
 * The vault file an embed names: at once when it was resolved before, else
 * loaded. Notes and bases are never kept, since their text changes.
 */
export function vaultEmbedResource(
  resources: Resources,
  link: { target: string; documentUri: string | undefined; isWiki: boolean },
): Resource | Promise<Resource> {
  const { target, documentUri } = link;
  const syntax = link.isWiki ? "wikilink" : "markdown";
  const key = `${syntax}\0${documentUri ?? ""}\0${target}`;
  const cached =
    resources.peek?.(target, documentUri, syntax) ??
    getCachedEmbedResource(resources, key);
  if (cached !== undefined) {
    return cached;
  }
  return resources.load(target, documentUri, syntax).then((resolved) => {
    if (resolved.kind !== "note" && resolved.kind !== "base") {
      setCachedEmbedResource(resources, key, resolved);
    }
    return resolved;
  });
}

/** Drop what embeds resolved with `resources`: the files may have changed. */
export function forgetEmbedResources(resources: Resources): void {
  embedResourceCaches.delete(resources);
}

export function getCachedEmbedResource(
  resources: Resources,
  key: string,
): Resource | undefined {
  const map = embedResourceCaches.get(resources);
  if (!map) {
    return undefined;
  }
  const cached = map.get(key);
  if (cached !== undefined) {
    map.delete(key);
    map.set(key, cached);
  }
  return cached;
}

export function setCachedEmbedResource(
  resources: Resources,
  key: string,
  resource: Resource,
): void {
  let map = embedResourceCaches.get(resources);
  if (!map) {
    map = new Map<string, Resource>();
    embedResourceCaches.set(resources, map);
  }
  if (map.has(key)) {
    map.delete(key);
  } else if (map.size >= EMBED_CACHE_LIMIT) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) {
      map.delete(oldest);
    }
  }
  map.set(key, resource);
}
