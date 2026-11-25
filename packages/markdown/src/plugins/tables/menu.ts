import {
  rectangle,
  type CellPosition,
  type CellRange,
  type Table,
} from "../../markdown/tables/model";
import type { Axis, TableOperation } from "../../markdown/tables/operations";
import type { MenuItem } from "../editor/api";
import { t } from "@workshop/l10n";

export interface TableMenuActions {
  copy(cut: boolean): Promise<void>;
  paste(plainText: boolean): Promise<void>;
  selectAll(): void;
  format(marker: string | null): void;
  clear(): void;
  /** A sort may finish later: it renders cells for its keys first. */
  execute(operation: TableOperation, focus: CellPosition): void | Promise<void>;
  canFormat?: boolean;
}

export function tableMenu(
  table: Table,
  range: CellRange,
  actions: TableMenuActions,
  axis?: Axis,
): MenuItem[] {
  const sorting = sortingItems(range, actions);
  if (axis) {
    return [
      ...axisItems({ table, range, actions, axis }),
      ...(axis === "column" ? sorting : []),
    ];
  }
  return [
    { label: t("Cut"), run: () => actions.copy(true) },
    { label: t("Copy"), run: () => actions.copy(false) },
    { label: t("Paste"), run: () => actions.paste(false) },
    { label: t("Paste as plain text"), run: () => actions.paste(true) },
    { label: t("Select all"), run: () => actions.selectAll() },
    {
      label: t("Format"),
      children: formatItems(actions),
      disabled: actions.canFormat === false,
    },
    {
      label: t("Row"),
      children: axisItems({ table, range, actions, axis: "row" }),
    },
    {
      label: t("Column"),
      children: axisItems({ table, range, actions, axis: "column" }),
    },
    ...sorting,
    { label: t("Clear selected cells"), run: () => actions.clear() },
  ];
}

/**
 * The items with each action reporting its failure through `report`, so the
 * table shows it; the failure is rethrown for the menu to log.
 */
export function reportingFailures(
  items: readonly MenuItem[],
  report: (message: string) => void,
): MenuItem[] {
  return items.map((item) => {
    const reporting: MenuItem = { ...item };
    const run = item.run;
    if (run) {
      reporting.run = async () => {
        try {
          await run();
        } catch (error) {
          report(
            error instanceof Error
              ? error.message
              : t("The table action could not be completed."),
          );
          throw error;
        }
      };
    }
    if (item.children) {
      reporting.children = reportingFailures(item.children, report);
    }
    return reporting;
  });
}

interface AxisMenuOptions {
  table: Table;
  range: CellRange;
  actions: TableMenuActions;
  axis: Axis;
}

function axisItems(options: AxisMenuOptions): MenuItem[] {
  const { table, range, actions, axis } = options;
  const area = rectangle(range);
  const row = axis === "row";
  const from = row ? area.top : area.left;
  const to = row ? area.bottom : area.right;
  const size = row ? table.rows.length : table.alignments.length;
  const focus = (index: number): CellPosition =>
    row ? { row: index, column: area.left } : { row: area.top, column: index };
  const item = (
    label: string,
    operation: TableOperation,
    index: number,
    disabled = false,
  ): MenuItem => ({
    label,
    run: () => actions.execute(operation, focus(index)),
    disabled,
  });
  // As in Obsidian, a new column is aligned as the one it is added beside.
  const words = axisWords(row);
  const items = [
    item(
      words.addBefore,
      { type: "insert", axis, index: from, ...(!row && { alignAs: from }) },
      from,
    ),
    item(
      words.addAfter,
      { type: "insert", axis, index: to + 1, ...(!row && { alignAs: to }) },
      to + 1,
    ),
  ];
  items.push(
    item(
      words.moveBack,
      { type: "move", axis, from, to, destination: from - 1 },
      from - 1,
      from === 0,
    ),
    item(
      words.moveForward,
      { type: "move", axis, from, to, destination: from + 1 },
      from + 1,
      to === size - 1,
    ),
  );
  if (!row) {
    items.push(...alignmentItems(range, actions));
  }
  items.push(
    item(words.duplicate, { type: "duplicate", axis, from, to }, to + 1),
    item(words.remove, { type: "delete", axis, from, to }, from),
  );
  return items;
}

/** What each row or column item says, as whole sentences to translate. */
function axisWords(row: boolean) {
  return row
    ? {
        addBefore: t("Add row above"),
        addAfter: t("Add row below"),
        moveBack: t("Move row up"),
        moveForward: t("Move row down"),
        duplicate: t("Duplicate row"),
        remove: t("Delete row"),
      }
    : {
        addBefore: t("Add column to the left"),
        addAfter: t("Add column to the right"),
        moveBack: t("Move column left"),
        moveForward: t("Move column right"),
        duplicate: t("Duplicate column"),
        remove: t("Delete column"),
      };
}

function alignmentItems(
  range: CellRange,
  actions: TableMenuActions,
): MenuItem[] {
  const area = rectangle(range);
  const labels = {
    left: t("Align left"),
    center: t("Align center"),
    right: t("Align right"),
  };
  return (["left", "center", "right"] as const).map((alignment) => ({
    label: labels[alignment],
    run: () =>
      actions.execute(
        { type: "align", from: area.left, to: area.right, alignment },
        range.head,
      ),
  }));
}

function formatItems(actions: TableMenuActions): MenuItem[] {
  return (
    [
      [t("Bold"), "**"],
      [t("Italic"), "*"],
      [t("Strikethrough"), "~~"],
      [t("Highlight"), "=="],
      [t("Code"), "`"],
      [t("Math"), "$"],
      [t("Comment"), "%%"],
      [t("Clear formatting"), null],
    ] as const
  ).map(([label, marker]) => ({ label, run: () => actions.format(marker) }));
}

function sortingItems(range: CellRange, actions: TableMenuActions): MenuItem[] {
  return (["ascending", "descending"] as const).map((direction) => ({
    label:
      direction === "ascending"
        ? t("Sort by column (A to Z)")
        : t("Sort by column (Z to A)"),
    run: () =>
      actions.execute(
        { type: "sort", column: range.head.column, direction },
        range.head,
      ),
  }));
}
