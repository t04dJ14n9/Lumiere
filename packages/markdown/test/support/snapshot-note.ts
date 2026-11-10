import { config as editorConfig } from "../../src/plugins/editor/manifest";
import type { NoteSettings } from "../../src/shared/host";

/**
 * A note whose first screen the snapshot can draw. `snapshotLayout()` skips
 * the snapshot for a centred page, an inline title or unsettled gutters, so
 * tests of the snapshot itself must state this layout explicitly instead of
 * leaning on product defaults: issue #689 aligned three defaults with Obsidian
 * 1.15.0, which intentionally puts the default chrome on the no-snapshot path.
 */
export type SnapshotNote = Pick<
  NoteSettings,
  "preset" | "mode" | "editor" | "features"
>;

/** The two plugin overrides that keep the snapshot's three gutters and no title. */
export const snapshotFeatures: NonNullable<NoteSettings["features"]> = {
  inlineTitle: { enabled: false, config: {} },
  lineNumbers: { enabled: true, config: { style: "on" } },
};

export function snapshotNote(
  editor: Record<string, unknown> = {},
): SnapshotNote {
  return {
    preset: "obsidian",
    mode: "livePreview",
    editor: editorConfig.parse({ ...editor, readableLineLength: false }),
    features: snapshotFeatures,
  };
}
