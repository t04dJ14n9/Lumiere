import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RUNTIME_COMMAND_IDS,
  SIDE_PANEL_COMMAND_IDS,
} from "../../src/shared/command-ids";
import { extensionManifest, pdfContributes } from "./support/manifest";

interface Contributes {
  commands: {
    command: string;
    title: string;
    category?: string;
    icon?: string;
    enablement?: string;
  }[];
  menus: Record<string, { command: string; when?: string; group?: string }[]>;
  keybindings?: { command: string }[];
}

const contributes = pdfContributes<Contributes>();
const IDS = SIDE_PANEL_COMMAND_IDS;

test("Toggle Side Panel is a PDF command, and Show and Hide are the title button's two states", () => {
  const command = (id: string) =>
    contributes.commands.find((entry) => entry.command === id);
  assert.equal(IDS.toggleSidePanel, "lumiere.pdf.toggleSidePanel");
  assert.deepEqual(
    [
      command(IDS.toggleSidePanel)?.category,
      command(IDS.toggleSidePanel)?.title,
    ],
    ["PDF", "Toggle Side Panel"],
  );
  // VS Code's own toggles use these two icons, for off and on.
  assert.equal(command(IDS.showSidePanel)?.icon, "$(layout-sidebar-left-off)");
  assert.equal(command(IDS.hideSidePanel)?.icon, "$(layout-sidebar-left)");
  for (const id of Object.values(IDS)) {
    assert.ok(RUNTIME_COMMAND_IDS.includes(id), id);
    assert.equal(command(id)?.enablement, "lumiere.pdf.pdfActive", id);
  }
});

test("the editor title shows a button for the viewer: Show while the panel is closed, Hide while it is open", () => {
  const title = contributes.menus["editor/title"]!;
  const show = title.find((entry) => entry.command === IDS.showSidePanel);
  const hide = title.find((entry) => entry.command === IDS.hideSidePanel);
  // The navigation group is the one whose entries are buttons, not in the "…" menu.
  assert.match(show?.group ?? "", /^navigation(@|$)/u);
  assert.match(hide?.group ?? "", /^navigation(@|$)/u);
  assert.equal(
    show?.when,
    "activeCustomEditorId == 'lumiere.pdf.viewer' && !lumiere.pdf.sidePanelOpen",
  );
  assert.equal(
    hide?.when,
    "activeCustomEditorId == 'lumiere.pdf.viewer' && lumiere.pdf.sidePanelOpen",
  );
  assert.equal(
    title.some((entry) => entry.command === IDS.toggleSidePanel),
    false,
  );
});

test("the palette offers Toggle for a PDF, and keeps Show and Hide to the button", () => {
  const palette = contributes.menus["commandPalette"]!;
  const when = (id: string) =>
    palette.find((entry) => entry.command === id)?.when;
  assert.equal(
    when(IDS.toggleSidePanel),
    "activeCustomEditorId == 'lumiere.pdf.viewer'",
  );
  assert.equal(when(IDS.showSidePanel), "false");
  assert.equal(when(IDS.hideSidePanel), "false");
});

test("no key is bound by default; Keyboard Shortcuts can bind Toggle Side Panel", () => {
  const bound = (contributes.keybindings ?? []).map((entry) => entry.command);
  for (const id of Object.values(IDS)) {
    assert.equal(bound.includes(id), false, id);
  }
});

test("the shipped manifest carries the same commands and buttons", () => {
  const manifest = extensionManifest<{
    contributes: Contributes;
  }>().contributes;
  for (const id of Object.values(IDS)) {
    assert.ok(
      manifest.commands.some((entry) => entry.command === id),
      id,
    );
  }
  assert.ok(
    manifest.menus["editor/title"]!.some(
      (entry) =>
        entry.command === IDS.showSidePanel &&
        entry.group?.startsWith("navigation"),
    ),
  );
});
