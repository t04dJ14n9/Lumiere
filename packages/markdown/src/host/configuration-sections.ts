import { allManifests } from "../plugins/catalog";
import type { Manifest } from "../shared/manifest";

/**
 * The configuration sections the plugins read: their own settings and the
 * native ones they mirror (`nativeConfigKeys`, such as `editor.fontSize` and
 * `files.autoSave`). A change anywhere else (a theme, another extension's
 * setting) cannot change what they see, so it must not re-render every note.
 */
export function watchedSections(
  manifests: readonly Manifest[] = allManifests(),
): readonly string[] {
  const native = manifests.flatMap((manifest) =>
    Object.values(manifest.nativeConfigKeys ?? {}).map(
      // `editor.fontFamily#default` reads the same setting's default.
      (key) => key.split("#")[0]!,
    ),
  );
  return [...new Set(["lumiere.markdown", ...native])];
}
