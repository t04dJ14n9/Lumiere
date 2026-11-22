import assert from "node:assert/strict";
import { test } from "node:test";
import { extensionManifest, pdfContributes } from "./support/manifest";

interface Contributes {
  commands: { command: string; title: string; enablement?: string }[];
  configuration: { properties: Record<string, unknown> };
  menus: Record<string, { command: string; when?: string }[]>;
  keybindings?: {
    command: string;
    key?: string;
    mac?: string;
    when?: string;
  }[];
}

const contributes = pdfContributes<Contributes>();

test("the selection envelope command is contributed and hidden from the palette", () => {
  assert.ok(
    contributes.commands.some(
      (entry) => entry.command === "vscodeEmbedPdf.bridge.envelope",
    ),
  );
  const palette = (
    contributes.menus.commandPalette as { command: string; when?: string }[]
  ).find((entry) => entry.command === "vscodeEmbedPdf.bridge.envelope");
  assert.equal(palette?.when, "false");
  assert.equal(
    (contributes.keybindings ?? []).some(
      (entry) => entry.command === "vscodeEmbedPdf.bridge.envelope",
    ),
    false,
  );
});

test("Copy Link for Agent is the only agent command; Copy for Agent and Ask Agent are gone", () => {
  const commands = contributes.commands.map((entry) => entry.command);
  assert.ok(commands.includes("lumiere.pdf.copyLinkForAgent"));
  assert.ok(!commands.includes("lumiere.pdf.copyForAgent"));
  for (const [menu, entries] of Object.entries(contributes.menus)) {
    assert.ok(
      !entries.some((entry) => entry.command === "lumiere.pdf.copyForAgent"),
      menu,
    );
  }
  assert.ok(
    contributes.menus["webview/context"]?.some(
      (entry) => entry.command === "lumiere.pdf.copyLinkForAgent",
    ),
    "webview/context",
  );
  assert.ok(
    !(contributes.menus["editor/title"] ?? []).some(
      (entry) => entry.command === "lumiere.pdf.copyLinkForAgent",
    ),
    "editor/title must not list Copy Link for Agent",
  );
  const palette = (contributes.menus["commandPalette"] ?? []).find(
    (entry) => entry.command === "lumiere.pdf.copyLinkForAgent",
  );
  assert.ok(palette, "commandPalette still registers the command entry");
  assert.equal(
    palette?.when,
    "false",
    "commandPalette hides Copy Link for Agent",
  );
  assert.ok(
    !(contributes.keybindings ?? []).some(
      (entry) => entry.command === "lumiere.pdf.copyForAgent",
    ),
  );
  // Ask Agent was renamed Copy Link for Agent, then Copy link to this; no
  // leftover id, title or setting.
  assert.deepEqual(
    contributes.commands
      .filter((entry) => /agent/iu.test(entry.command))
      .map((entry) => entry.title),
    ["Copy link to this"],
  );
  assert.ok(!JSON.stringify(contributes).includes("Copy Link for Agent"));
  assert.ok(!JSON.stringify(contributes).includes("askAgent"));
  assert.ok(
    "lumiere.pdf.copyLinkForAgent.target" in
      contributes.configuration.properties,
  );
});

test("every default shortcut is scoped to the PDF viewer, to non-input focus and to the opt-out setting", () => {
  const bindings = (contributes.keybindings ?? []) as {
    key: string;
    mac?: string;
    command: string;
    when?: string;
  }[];
  assert.ok(bindings.length > 0);
  const seen = new Set<string>();
  for (const { key, mac, command, when } of bindings) {
    // Outline Ctrl+Alt+O must win over Go to Symbol even when the webview or
    // side bar has focus; it uses focusedView instead of the shared guards.
    if (
      command === "lumiere.pdf.outline.focus" ||
      command === "workbench.action.closeSidebar" ||
      command === "workbench.action.closeAuxiliaryBar" ||
      command === "workbench.action.closePanel"
    ) {
      assert.match(when ?? "", /config\.lumiere\.pdf\.keyboardShortcuts/u);
      assert.ok(key === "ctrl+alt+o" || mac === "ctrl+cmd+o", command);
      for (const chord of new Set([key, mac ?? key])) {
        assert.ok(!seen.has(`${chord}|${when}`), `duplicate ${chord}`);
        seen.add(`${chord}|${when}`);
      }
      continue;
    }
    assert.ok(command.startsWith("lumiere.pdf."), command);
    for (const clause of [
      "activeCustomEditorId == 'lumiere.pdf.viewer'",
      "!inputFocus",
      "!sideBarFocus",
      "!panelFocus",
      "!auxiliaryBarFocus",
      "config.lumiere.pdf.keyboardShortcuts",
    ]) {
      assert.ok(when?.includes(clause), `${command} (${key}) lacks ${clause}`);
    }
    // No two of our own bindings share a key under the same condition.
    for (const chord of new Set([key, mac ?? key])) {
      assert.ok(!seen.has(`${chord}|${when}`), `duplicate ${chord}`);
      seen.add(`${chord}|${when}`);
    }
  }
  const setting = contributes.configuration.properties[
    "lumiere.pdf.keyboardShortcuts"
  ] as { default: boolean };
  assert.equal(setting.default, true);
});

test("Ctrl+Alt+O focuses PDF Outline with titles, and closes the chrome that hosts it when focused", () => {
  const bindings = (contributes.keybindings ?? []) as {
    key: string;
    mac?: string;
    command: string;
    when?: string;
  }[];
  const outlineKeys = bindings.filter((entry) => entry.key === "ctrl+alt+o");
  assert.deepEqual(
    outlineKeys.map((entry) => [entry.command, entry.mac, entry.when]).sort(),
    [
      [
        "lumiere.pdf.outline.focus",
        "ctrl+cmd+o",
        "activeCustomEditorId == 'lumiere.pdf.viewer' && focusedView != 'lumiere.pdf.outline' && config.lumiere.pdf.keyboardShortcuts",
      ],
      [
        "workbench.action.closeAuxiliaryBar",
        "ctrl+cmd+o",
        "focusedView == 'lumiere.pdf.outline' && auxiliaryBarFocus && config.lumiere.pdf.keyboardShortcuts",
      ],
      [
        "workbench.action.closePanel",
        "ctrl+cmd+o",
        "focusedView == 'lumiere.pdf.outline' && panelFocus && config.lumiere.pdf.keyboardShortcuts",
      ],
      [
        "workbench.action.closeSidebar",
        "ctrl+cmd+o",
        "focusedView == 'lumiere.pdf.outline' && sideBarFocus && config.lumiere.pdf.keyboardShortcuts",
      ],
    ].sort(),
  );
  // Title actions from expand/follow still hang off the outline view.
  const menus = contributes.menus["view/title"] as {
    command: string;
    when: string;
  }[];
  assert.ok(
    menus.some(
      (item) =>
        item.command === "lumiere.pdf.expandOutline" &&
        item.when === "view == lumiere.pdf.outline",
    ),
  );
  assert.ok(
    menus.some(
      (item) => item.command === "lumiere.pdf.enableOutlineFollowCursor",
    ),
  );
  assert.ok(
    menus.some(
      (item) => item.command === "lumiere.pdf.disableOutlineFollowCursor",
    ),
  );
});

test("Ctrl/Cmd+Shift+O opens Go to Outline Item… on the PDF viewer without colliding with Markdown or outline focus", () => {
  const goTo = contributes.commands.find(
    (entry) => entry.command === "lumiere.pdf.goToOutlineItem",
  );
  assert.equal(goTo?.title, "Go to Outline Item…");
  const bindings = (contributes.keybindings ?? []) as {
    key: string;
    mac?: string;
    command: string;
    when?: string;
  }[];
  const shiftO = bindings.filter(
    (entry) => entry.key === "ctrl+shift+o" || entry.mac === "cmd+shift+o",
  );
  assert.deepEqual(
    shiftO.map((entry) => [entry.command, entry.key, entry.mac, entry.when]),
    [
      [
        "lumiere.pdf.goToOutlineItem",
        "ctrl+shift+o",
        "cmd+shift+o",
        "activeCustomEditorId == 'lumiere.pdf.viewer' && !inputFocus && !sideBarFocus && !panelFocus && !auxiliaryBarFocus && config.lumiere.pdf.keyboardShortcuts",
      ],
    ],
  );
  // Outline focus stays on Ctrl+Alt+O / Ctrl+Cmd+O, not Shift+O.
  assert.equal(
    bindings.some(
      (entry) =>
        entry.command === "lumiere.pdf.outline.focus" &&
        (entry.key === "ctrl+shift+o" || entry.mac === "cmd+shift+o"),
    ),
    false,
  );
  const palette = (
    contributes.menus.commandPalette as { command: string; when?: string }[]
  ).find((entry) => entry.command === "lumiere.pdf.goToOutlineItem");
  assert.equal(palette?.when, "activeCustomEditorId == 'lumiere.pdf.viewer'");
});

test("Look Up is a setting, hidden from the palette and offered on macOS when enabled, with the clicked word resolved by its command", () => {
  const setting = contributes.configuration.properties[
    "lumiere.pdf.lookUp.enabled"
  ] as { default: boolean };
  assert.equal(setting.default, true);
  const palette = (
    contributes.menus.commandPalette as { command: string; when?: string }[]
  ).find((entry) => entry.command === "lumiere.pdf.lookUp");
  assert.equal(palette?.when, "false");
  const menu = (
    contributes.menus["webview/context"] as { command: string; when?: string }[]
  ).find((entry) => entry.command === "lumiere.pdf.lookUp");
  assert.match(menu?.when ?? "", /isMac/u);
  assert.match(menu?.when ?? "", /config\.lumiere\.pdf\.lookUp\.enabled/u);
});

test("turning the page keeping the place: Option+Arrow on macOS, Ctrl+Alt+Arrow elsewhere, never plain Alt+Arrow (VS Code Go Back/Forward)", () => {
  const bindings = (contributes.keybindings ?? []) as {
    key: string;
    mac?: string;
    command: string;
  }[];
  const keep = bindings.filter((entry) => /KeepingPlace$/u.test(entry.command));
  assert.deepEqual(
    keep
      .map((entry) => [
        entry.command.replace("lumiere.pdf.", ""),
        entry.key,
        entry.mac,
      ])
      .sort(),
    [
      ["nextPageKeepingPlace", "ctrl+alt+down", "alt+down"],
      ["nextPageKeepingPlace", "ctrl+alt+right", "alt+right"],
      ["previousPageKeepingPlace", "ctrl+alt+left", "alt+left"],
      ["previousPageKeepingPlace", "ctrl+alt+up", "alt+up"],
    ],
  );
  for (const entry of bindings) {
    assert.ok(
      !/^alt\+(left|right)$/u.test(entry.key),
      `${entry.command}: ${entry.key} would take VS Code's Go Back/Forward`,
    );
  }
});

test("zen mode: Enter and Exit are chosen by inZenMode, bound to Ctrl+Alt+Z (Ctrl+Cmd+Z on macOS) and Esc Esc, only in the PDF editor and under the shortcuts setting", () => {
  const commands = contributes.commands.map((entry) => entry.command);
  assert.ok(
    commands.includes("lumiere.pdf.enterZen") &&
      commands.includes("lumiere.pdf.exitZen"),
  );
  const zen = (contributes.keybindings ?? []).filter((entry) =>
    /Zen$/u.test(entry.command),
  );
  assert.deepEqual(
    zen.map((entry) => [
      entry.command.replace("lumiere.pdf.", ""),
      entry.key,
      entry.mac,
    ]),
    [
      ["enterZen", "ctrl+alt+z", "ctrl+cmd+z"],
      ["exitZen", "ctrl+alt+z", "ctrl+cmd+z"],
      ["exitZen", "escape escape", undefined],
    ],
  );
  for (const entry of zen) {
    assert.match(
      entry.when ?? "",
      /activeCustomEditorId == 'lumiere\.pdf\.viewer'/u,
    );
    assert.match(entry.when ?? "", /config\.lumiere\.pdf\.keyboardShortcuts/u);
    assert.match(
      entry.when ?? "",
      entry.command.endsWith("enterZen") ? /!inZenMode/u : /(?<!!)inZenMode/u,
    );
  }
});

test("settings commands: Open Settings and the common toggles are in the palette, with a Settings… entry in the viewer menu", () => {
  const commands = contributes.commands.map((entry) => entry.command);
  for (const id of [
    "openSettings",
    "toggleSmoothScrolling",
    "toggleKeyboardShortcuts",
    "setDefaultZoom",
    "setDefaultPageLayout",
    "setDefaultScrollMode",
  ]) {
    assert.ok(commands.includes(`lumiere.pdf.${id}`), id);
    const hidden = (
      contributes.menus.commandPalette as { command: string; when?: string }[]
    ).find((entry) => entry.command === `lumiere.pdf.${id}`);
    assert.equal(
      hidden,
      undefined,
      `${id} must be available whatever the active editor is`,
    );
  }
  assert.ok(
    (contributes.menus["webview/context"] as { command: string }[]).some(
      (entry) => entry.command === "lumiere.pdf.openSettings",
    ),
  );
});

test("the viewer declares limited Restricted Mode support, so PDFs render instead of opening as raw bytes", () => {
  const manifest = extensionManifest<{
    capabilities?: {
      untrustedWorkspaces?: {
        supported?: unknown;
        restrictedConfigurations?: string[];
      };
    };
  }>();
  const untrusted = manifest.capabilities?.untrustedWorkspaces;
  assert.equal(untrusted?.supported, "limited");
  // The local MCP server must never be switched on by a workspace setting of an untrusted folder.
  assert.ok(
    untrusted?.restrictedConfigurations?.includes(
      "lumiere.pdf.agentBridge.enabled",
    ),
  );
  assert.ok(
    untrusted?.restrictedConfigurations?.includes(
      "lumiere.pdf.copyLinkForAgent.target",
    ),
  );
  // The list is the extension's, shared with Lumiere's Markdown settings.
  for (const key of untrusted?.restrictedConfigurations ?? []) {
    if (key.startsWith("lumiere.pdf.")) {
      assert.ok(key in contributes.configuration.properties, key);
    }
  }
});

test("PDF location history has distinct commands and does not claim native or Vim shortcuts", () => {
  for (const name of ["historyBack", "historyForward"]) {
    const command = `lumiere.pdf.${name}`;
    assert.ok(contributes.commands.some((entry) => entry.command === command));
    assert.ok(
      contributes.menus["editor/title"]?.some(
        (entry) => entry.command === command,
      ),
    );
    assert.ok(
      !(contributes.keybindings ?? []).some(
        (entry) => entry.command === command,
      ),
    );
  }
});

test("Copy link to this is enabled when the PDF is active even without selection", () => {
  const command = contributes.commands.find(
    (entry) => entry.command === "lumiere.pdf.copyLinkForAgent",
  );
  assert.ok(command, "Copy link command");
  assert.match(
    command!.enablement ?? "",
    /lumiere\.pdf\.pdfActive/,
    "enablement requires an active PDF, not a selection",
  );
  assert.doesNotMatch(
    command!.enablement ?? "",
    /hasSelection/,
    "enablement must not require hasSelection",
  );
  const context = contributes.menus["webview/context"]?.find(
    (entry) => entry.command === "lumiere.pdf.copyLinkForAgent",
  );
  assert.ok(context?.when, "webview/context when");
  assert.match(context!.when!, /webviewId == 'lumiere\.pdf\.viewer'/);
  assert.doesNotMatch(
    context!.when!,
    /hasSelection/,
    "context menu must work without a selection",
  );
  assert.ok(
    !contributes.commands.some((entry) => /add notes/iu.test(entry.title)),
    "no Add notes command",
  );
  assert.ok(
    !JSON.stringify(contributes).includes("Add notes"),
    "no Add notes contribution",
  );
});

test("pdfRegions setting defaults off and gates Select Region menus and shortcut", () => {
  const setting = contributes.configuration.properties[
    "lumiere.pdf.regions.enabled"
  ] as { type?: string; default?: boolean } | undefined;
  assert.ok(setting, "lumiere.pdf.regions.enabled must be contributed");
  assert.equal(setting?.type, "boolean");
  assert.equal(setting?.default, false);

  const gatedMenus = [
    "editor/title",
    "commandPalette",
    "webview/context",
  ] as const;
  for (const menu of gatedMenus) {
    const entry = contributes.menus[menu]?.find(
      (item) => item.command === "lumiere.pdf.selectRegionTool",
    );
    assert.ok(entry, `${menu} Select Region entry`);
    assert.match(
      entry!.when ?? "",
      /config\.lumiere\.pdf\.regions\.enabled/,
      `${menu} must require regions.enabled`,
    );
  }

  const binding = (contributes.keybindings ?? []).find(
    (entry) => entry.command === "lumiere.pdf.selectRegionTool",
  );
  assert.ok(binding, "Select Region keybinding");
  assert.match(
    binding!.when ?? "",
    /config\.lumiere\.pdf\.regions\.enabled/,
    "keybinding must require regions.enabled",
  );
});

interface BookmarkContributes {
  commands: {
    command: string;
    title: string;
    category?: string;
    icon?: string;
  }[];
  views: Record<string, { id: string; name: string; when: string }[]>;
  viewsWelcome: { view: string; contents: string; when?: string }[];
  menus: Record<string, { command: string; when?: string; group?: string }[]>;
}
const bookmarks = contributes as unknown as BookmarkContributes;

test("bookmarks: Add and Go to are in the palette only for a PDF, Rename and Delete only on rows", () => {
  const titles = Object.fromEntries(
    bookmarks.commands
      .filter((entry) => /Bookmark$|Bookmark…$/u.test(entry.title))
      .map((entry) => [entry.command, [entry.category, entry.title]]),
  );
  assert.deepEqual(titles, {
    "lumiere.pdf.addBookmark": ["PDF", "Add Bookmark"],
    "lumiere.pdf.goToBookmark": ["PDF", "Go to Bookmark…"],
    "lumiere.pdf.renameBookmark": ["PDF", "Rename Bookmark…"],
    "lumiere.pdf.deleteBookmark": ["PDF", "Delete Bookmark"],
  });
  const palette = Object.fromEntries(
    (bookmarks.menus["commandPalette"] ?? []).map((entry) => [
      entry.command,
      entry.when,
    ]),
  );
  for (const id of ["addBookmark", "goToBookmark"]) {
    assert.equal(
      palette[`lumiere.pdf.${id}`],
      "activeCustomEditorId == 'lumiere.pdf.viewer'",
    );
  }
  for (const id of ["renameBookmark", "deleteBookmark"]) {
    assert.equal(palette[`lumiere.pdf.${id}`], "false");
  }
});

test("bookmarks: PDF Bookmarks is an Explorer view shown while a PDF is active, with a welcome that offers Add Bookmark", () => {
  const explorer = bookmarks.views["explorer"] ?? [];
  const outline = explorer.find((view) => view.id === "lumiere.pdf.outline");
  const view = explorer.find((entry) => entry.id === "lumiere.pdf.bookmarks");
  assert.equal(view?.name, "PDF Bookmarks");
  // The same condition as PDF Outline: not shown once the PDF is left.
  assert.equal(view?.when, outline?.when);
  assert.equal(view?.when, "lumiere.pdf.pdfActive");
  const welcome = bookmarks.viewsWelcome.filter(
    (entry) => entry.view === "lumiere.pdf.bookmarks",
  );
  assert.deepEqual(
    welcome.map((entry) => entry.contents),
    ["No bookmarks yet.\n[Add Bookmark](command:lumiere.pdf.addBookmark)"],
  );
});

test("bookmarks: the view title adds one, and each row renames or deletes, inline and in its menu", () => {
  const add = bookmarks.menus["view/title"]?.filter(
    (entry) => entry.command === "lumiere.pdf.addBookmark",
  );
  assert.deepEqual(add, [
    {
      command: "lumiere.pdf.addBookmark",
      when: "view == lumiere.pdf.bookmarks",
      group: "navigation@1",
    },
  ]);
  const rows = bookmarks.menus["view/item/context"] ?? [];
  const groups = (command: string) =>
    rows
      .filter((entry) => entry.command === command)
      .map((entry) => entry.group)
      .sort();
  assert.deepEqual(groups("lumiere.pdf.renameBookmark"), [
    "1_modification@1",
    "inline@1",
  ]);
  assert.deepEqual(groups("lumiere.pdf.deleteBookmark"), [
    "1_modification@2",
    "inline@2",
  ]);
  for (const entry of rows) {
    assert.equal(
      entry.when,
      "view == lumiere.pdf.bookmarks && viewItem == lumiere.pdf.bookmark",
    );
  }
  for (const entry of bookmarks.commands) {
    if (entry.command === "lumiere.pdf.renameBookmark") {
      assert.equal(entry.icon, "$(edit)");
    }
    if (entry.command === "lumiere.pdf.deleteBookmark") {
      assert.equal(entry.icon, "$(trash)");
    }
  }
});

test("bookmarks: the editor's … menu has Add Bookmark and Go to Bookmark… for a PDF", () => {
  const menu = Object.fromEntries(
    (bookmarks.menus["editor/title"] ?? []).map((entry) => [
      entry.command,
      [entry.when, entry.group],
    ]),
  );
  const viewer = "activeCustomEditorId == 'lumiere.pdf.viewer'";
  assert.deepEqual(menu["lumiere.pdf.addBookmark"], [viewer, "1_pdfPage@4"]);
  assert.deepEqual(menu["lumiere.pdf.goToBookmark"], [viewer, "1_pdfPage@5"]);
});

test("bookmarks: Add Bookmark is Preview's Cmd+D (Ctrl+D elsewhere), and Go to Bookmark has no key of its own", () => {
  const bindings = (contributes.keybindings ?? []).filter((entry) =>
    /Bookmark$/u.test(entry.command),
  );
  assert.deepEqual(
    bindings.map((entry) => [entry.command, entry.key, entry.mac]),
    [["lumiere.pdf.addBookmark", "ctrl+d", "cmd+d"]],
  );
  // VS Code's own Ctrl/Cmd+D is Add Selection to Next Find Match, in a text
  // editor: no other binding of ours takes the key.
  const taken = (contributes.keybindings ?? []).filter(
    (entry) => entry.key === "ctrl+d" || entry.mac === "cmd+d",
  );
  assert.equal(taken.length, 1);
});
