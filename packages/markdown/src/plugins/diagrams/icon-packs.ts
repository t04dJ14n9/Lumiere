import type { AsyncIconLoader } from "mermaid";

/**
 * The Iconify packs Mermaid diagrams name. `fa:fa-car` in a label and
 * `icon(fa:…)` look up the `fa`, `fas`, `far` and `fab` prefixes, as Font
 * Awesome's own classes do; architecture and treeView diagrams name `logos:`
 * and treeView's `material-icon-theme`. Each loader is an `import()`, so a
 * pack's chunk is fetched the first time a diagram uses one of its icons.
 * Without a pack Mermaid draws a `?` box or leaves `fa:fa-car` as text.
 */
export const ICON_PACKS: readonly AsyncIconLoader[] = [
  { name: "fa", loader: solid },
  { name: "fas", loader: solid },
  {
    name: "far",
    loader: async () => (await import("@iconify-json/fa6-regular")).icons,
  },
  {
    name: "fab",
    loader: async () => (await import("@iconify-json/fa6-brands")).icons,
  },
  {
    name: "logos",
    loader: async () => (await import("@iconify-json/logos")).icons,
  },
  {
    name: "material-icon-theme",
    loader: async () =>
      (await import("@iconify-json/material-icon-theme")).icons,
  },
];

async function solid() {
  return (await import("@iconify-json/fa6-solid")).icons;
}

interface IconPackRegistry {
  registerIconPacks(loaders: AsyncIconLoader[]): void;
}

const registered = new WeakSet<IconPackRegistry>();

/** Register the packs once per Mermaid instance; registering is synchronous and loads nothing. */
export function registerIconPacks(mermaid: IconPackRegistry): void {
  if (registered.has(mermaid)) {
    return;
  }
  mermaid.registerIconPacks([...ICON_PACKS]);
  registered.add(mermaid);
}
