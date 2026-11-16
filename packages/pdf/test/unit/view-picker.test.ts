import assert from "node:assert/strict";
import { test } from "node:test";
// First: everything below imports 'vscode', which this points at the fake.
import "./support/install-fake-vscode";
import * as vscode from "./support/fake-vscode";
import { registerViewControls } from "../../src/extension/plugins/pdf/view-controls";
import type { PdfPanels } from "../../src/extension/plugins/pdf/panels";
import { VIEW_CONTROL_COMMAND_IDS } from "../../src/shared/command-ids";

/** The View picker's rows for a panel whose viewer reported `view`. */
async function pickerRows(view: unknown) {
  const registerCommand = vscode.commands.registerCommand;
  const showQuickPick = vscode.window.showQuickPick;
  let selectView: (() => Promise<void>) | undefined;
  let rows: { label: string; description?: string }[] | undefined;
  vscode.commands.registerCommand = ((id: string, run: () => Promise<void>) => {
    if (id === VIEW_CONTROL_COMMAND_IDS.selectView) {
      selectView = run;
    }
    return registerCommand(id);
  }) as never;
  vscode.window.showQuickPick = (async (items: typeof rows) => {
    rows = items;
    return undefined;
  }) as never;
  try {
    const panels = { active: { view, act() {} } } as unknown as PdfPanels;
    registerViewControls(panels);
    await selectView!();
    return rows;
  } finally {
    vscode.commands.registerCommand = registerCommand;
    vscode.window.showQuickPick = showQuickPick;
  }
}

test("the View picker opens before the viewer has reported its view, with nothing marked current", async () => {
  const rows = await pickerRows(undefined);
  assert.ok(rows, "the picker opened");
  assert.ok(rows.some((row) => row.label.includes("Settings…")));
  assert.equal(rows.filter((row) => row.description === "current").length, 0);
});

test("the View picker marks the view the viewer reported", async () => {
  const rows = await pickerRows({ fit: "width" });
  assert.equal(
    rows?.find((row) => row.label === "Fit width")?.description,
    "current",
  );
});
