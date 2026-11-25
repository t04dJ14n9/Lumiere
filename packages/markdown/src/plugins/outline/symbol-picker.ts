import type { Context } from "@workshop/core";
import { metadata } from "../../markdown/metadata";
import { SourceCoordinates } from "../../shared/document/coordinates";
import { fuzzyMatch } from "../../shared/fuzzy";
import type { Dialogs, PickItem } from "../../shared/host";
import { GO_TO_HEADING_COMMAND } from "./commands";
import { jumpToHeading, type HeadingJumps } from "./jump";
import { outlineSymbols, type OutlineSymbolNode } from "./symbols";
import { t } from "@workshop/l10n";

/**
 * CustomTextEditorProvider supplies a TextDocument, but its active control is
 * a webview: VS Code's native symbol UI needs a code editor. Use the supported
 * Quick Pick API instead of contributing a second provider to the text model.
 */
export function registerSymbolPicker(ctx: Context, dialogs: Dialogs): void {
  const editors = ctx.editors;
  // Captured while live, as `editors`: the pick can end after the plugin stops.
  const jumps: HeadingJumps = {
    vaults: ctx.vaults,
    settings: ctx.settings,
    dialogs,
    logger: ctx.logger,
  };
  let disposed = false;
  ctx.effect(() => () => {
    disposed = true;
  });
  ctx.effect(() =>
    ctx.hostCommands.register(GO_TO_HEADING_COMMAND, async () => {
      const panel = editors.active();
      if (!panel) {
        return;
      }
      const document = panel.document;
      const version = document.version;
      const coordinates = new SourceCoordinates(document.getText());
      const headings = metadata(coordinates.editor).headings;
      const items = symbolItems(outlineSymbols(headings), coordinates);
      const result = await dialogs.pick({
        placeholder: items.length
          ? t("Go to heading…")
          : t("No headings in this note."),
        items: (query) => filterSymbols(items, query),
      });
      if (
        disposed ||
        !result?.item ||
        editors.active() !== panel ||
        document.version !== version
      ) {
        return;
      }
      await jumpToHeading(
        jumps,
        { uri: document.uri, document },
        result.item.value,
      );
    }),
  );
}

function symbolItems(
  nodes: readonly OutlineSymbolNode[],
  coordinates: SourceCoordinates,
  ancestors: readonly string[] = [],
): PickItem<number>[] {
  return nodes.flatMap((node) => [
    {
      label: node.name,
      description: `H${node.level}`,
      ...(ancestors.length && { detail: ancestors.join(" › ") }),
      value: coordinates.toSource(node.selectionStart),
    },
    ...symbolItems(node.children, coordinates, [...ancestors, node.name]),
  ]);
}

function filterSymbols(
  items: readonly PickItem<number>[],
  query: string,
): readonly PickItem<number>[] {
  if (!query.trim()) {
    return items;
  }
  return items
    .map((item) => ({ item, match: fuzzyMatch(query, item.label) }))
    .filter((entry) => entry.match !== undefined)
    .sort((left, right) => right.match!.score - left.match!.score)
    .map((entry) => entry.item);
}
