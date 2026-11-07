import type { BlockRenderer } from "../livePreview/api";
import { parseTable } from "../../markdown/tables/model";

/**
 * The table editor needs a table it can read. A table inside a quote keeps
 * its "> " markers in the node's source, which `parseTable` cannot read, so
 * it stays text rather than crashing the editor.
 */
export const matchesEditableTable: BlockRenderer["match"] = (node, state) =>
  node.name === "Table" &&
  parseTable(state.sliceDoc(node.from, node.to)) !== undefined;
