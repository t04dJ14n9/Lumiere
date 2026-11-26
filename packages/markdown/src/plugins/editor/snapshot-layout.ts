import { features } from "../catalog";
import type { NoteSettings } from "../../shared/host";
import { fontVariables, type Platform } from "./font";
import { config as editorConfig } from "./manifest";

/** The snapshot element's class, in the first HTML and in the stylesheet. */
export const SNAPSHOT_CLASS = "mw-snapshot";

/**
 * What the first-paint snapshot (`snapshot.ts`) assumes about the note's
 * presentation. The host builds the snapshot before the note's settings are
 * final (an Obsidian vault's own settings arrive later), so the webview
 * computes the layout again from its `init` and drops a snapshot whose `key`
 * differs, instead of letting the note jump when the editor replaces it.
 */
export interface SnapshotLayout {
  readonly key: string;
  /** The note's font variables; the editor sets the same ones as a theme. */
  readonly vars: Readonly<Record<string, string>>;
  readonly tabSize: number;
  /** Whether Properties draws the frontmatter (a sheet the snapshot reserves). */
  readonly properties: boolean;
  /** Properties' list preview: above 0 a list shows fewer chips than the skeleton. */
  readonly listPreviewCount: number;
  /** Whether the note's Properties are stored collapsed: the sheet is its heading alone. */
  readonly isCollapsed: boolean;
  /** Whether tags are drawn as tags (otherwise they stay plain text). */
  readonly tags: boolean;
}

/**
 * Whether the note opens at its top with the caret at the start, as the
 * snapshot draws it; a search match or a transferred line pins another place.
 */
export function opensAtTop(
  selection: { anchor: number; head: number; topLine?: number } | undefined,
): boolean {
  return (
    !selection ||
    selection.anchor + selection.head + (selection.topLine ?? 0) === 0
  );
}

type Presentation = Pick<
  NoteSettings,
  "preset" | "mode" | "editor" | "features"
>;

const defaultsOn = new Map(
  features.map((manifest) => [manifest.id, manifest.defaultEnabled]),
);

type Feature = { enabled: boolean; config: Record<string, unknown> };

/** Which of the settled editor's three gutter columns its settings give. */
export interface SettledGutters {
  readonly lineNumbers: boolean;
  readonly gitGutter: boolean;
  readonly folding: boolean;
}

/**
 * The gutter columns the editor will have once its features have loaded
 * (the line numbers, the change bars, the fold markers), from the features
 * it was sent. `defaults` says whether a feature with no setting is on.
 */
export function settledGutters(
  features: NoteSettings["features"],
  defaults = true,
): SettledGutters {
  const isOn = (id: string) =>
    features?.[id]?.enabled ?? (defaults && (defaultsOn.get(id) ?? false));
  return {
    lineNumbers:
      isOn("lineNumbers") && features?.lineNumbers?.config.style !== "off",
    gitGutter: isOn("gitGutter"),
    folding: isOn("folding"),
  };
}

/** Whether line numbers, change bars and fold markers will all be there. */
function hasSettledGutters(feature: (id: string) => Feature | undefined) {
  const isOn = (id: string) =>
    feature(id)?.enabled ?? defaultsOn.get(id) ?? false;
  const style = feature("lineNumbers")?.config.style ?? "on";
  return (
    isOn("lineNumbers") &&
    style === "on" &&
    isOn("gitGutter") &&
    isOn("folding")
  );
}

/**
 * The layout of a note in Live Preview with the settled editor's three
 * gutter columns (line numbers, change bars, fold markers), or undefined
 * when the snapshot would not match what the editor draws: Source mode,
 * a centred or right-to-left page, an inline title, fewer gutters.
 */
export function snapshotLayout(
  note: Presentation,
  platform: Platform,
  isCollapsed = false,
): SnapshotLayout | undefined {
  const editor = editorConfig.parse(note.editor ?? {});
  const feature = (id: string) => note.features?.[id];
  const isOn = (id: string) =>
    feature(id)?.enabled ?? defaultsOn.get(id) ?? false;
  const isPlainPage = !editor.readableLineLength && !editor.rightToLeft;
  if (
    note.preset !== "obsidian" ||
    note.mode !== "livePreview" ||
    !isPlainPage ||
    isOn("inlineTitle") ||
    // Wikilinks are drawn by the links plugin; without it they stay source.
    !isOn("links") ||
    !hasSettledGutters(feature)
  ) {
    return undefined;
  }
  const vars = fontVariables(editor, platform);
  const display = feature("properties")?.config.display ?? "visible";
  const properties = isOn("properties") && display === "visible";
  const tags = isOn("tags");
  const listPreviewCount = Number(
    feature("properties")?.config.listPreviewCount ?? 0,
  );
  return {
    key: JSON.stringify({
      vars,
      tabSize: editor.tabSize,
      properties,
      listPreviewCount,
      isCollapsed,
      tags,
    }),
    vars,
    tabSize: editor.tabSize,
    properties,
    listPreviewCount,
    isCollapsed,
    tags,
  };
}
