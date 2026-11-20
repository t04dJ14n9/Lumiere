import { parseTable, type Table } from "./model";

/** Few: a large table's model holds an object per cell. */
const RECENT_LIMIT = 4;
const recent = new Map<string, Table | undefined>();

/**
 * `parseTable`, remembering the last few sources. One cell keystroke reads
 * the same new table source several times (the projected edit, Live
 * Preview's renderer match, the widget update, its estimated height), and
 * parsing is linear in the table's size. The model is shared: callers never
 * change it.
 */
export function parsedTable(source: string): Table | undefined {
  if (recent.has(source)) {
    const table = recent.get(source);
    recent.delete(source);
    recent.set(source, table);
    return table;
  }
  const table = parseTable(source);
  recent.set(source, table);
  if (recent.size > RECENT_LIMIT) {
    recent.delete(recent.keys().next().value!);
  }
  return table;
}
