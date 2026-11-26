/**
 * Which features the webview needs for a note's first view. It applies them
 * in phases after the editor exists (webview/features.ts), and the host lists
 * their chunks as modulepreload hints in the page (host/feature-chunks.ts) so
 * the fetches overlap with the entry's.
 */

/**
 * Editor chrome geometry first: Properties sheet + line-number gutter so the
 * first meaningful frame does not flash missing sheet/gutter then inject them
 * on the later paint phase. Tags stay in paint (not layout chrome). Tables /
 * callouts / … still wait on paint so they cannot gate the sheet.
 */
export const CHROME_FEATURE_IDS: ReadonlySet<string> = new Set([
  "properties",
  "lineNumbers",
]);

/**
 * Visible structure for the first screen after chrome. Includes tags plus
 * tables/callouts/… Editing helpers and heavier features load in the deferred
 * "all" phase after first paint.
 */
export const RENDER_AFFECTING_FEATURE_IDS: ReadonlySet<string> = new Set([
  "callouts",
  "codeBlocks",
  "diagrams",
  "embeds",
  "footnotes",
  "links",
  "math",
  "onlineVideos",
  "tables",
  "tags",
  "tasks",
]);

export const PAINT_FEATURE_IDS: ReadonlySet<string> = new Set([
  ...CHROME_FEATURE_IDS,
  ...RENDER_AFFECTING_FEATURE_IDS,
  "formatting",
  "smartLists",
  "vim",
]);

/**
 * The block widget each first-view feature draws in place of a block's source,
 * by the `kind` of the renderer it registers. Until the feature has loaded the
 * block is raw Markdown (`> [!note]`, pipes, `$$`), so Live Preview holds the
 * block's place with an empty shell instead (livePreview/pending-blocks.ts).
 */
export const BLOCK_RENDERER_KINDS: Readonly<Record<string, string>> = {
  callouts: "callout",
  diagrams: "diagram",
  embeds: "embed",
  math: "math",
  properties: "properties",
  tables: "Table",
};

/**
 * First-view features with no block widget to wait for: they decorate text in
 * place (links, tags, footnote marks, task boxes, code colours; inline images
 * and math are widgets within a line, which the line's height does not wait
 * on) or only add behaviour (videos play inside embeds' blocks).
 */
export const NO_BLOCK_WIDGET: ReadonlySet<string> = new Set([
  "codeBlocks",
  "footnotes",
  "links",
  "onlineVideos",
  "tags",
  "tasks",
]);

/** The files each feature's chunk graph adds to the entry's (scripts/feature-chunks.mjs). */
export type FeatureChunks = Readonly<Record<string, readonly string[]>>;

/**
 * The files the first view needs: those of the chrome and paint features that
 * `enabled` accepts, chrome first (the order the webview asks for them), each
 * file once even when features share it.
 */
export function firstViewFiles(
  chunks: FeatureChunks,
  enabled: (id: string) => boolean,
): string[] {
  const ids = [...PAINT_FEATURE_IDS].sort(
    (a, b) =>
      Number(CHROME_FEATURE_IDS.has(b)) - Number(CHROME_FEATURE_IDS.has(a)),
  );
  const files = ids.filter(enabled).flatMap((id) => chunks[id] ?? []);
  return [...new Set(files)];
}
