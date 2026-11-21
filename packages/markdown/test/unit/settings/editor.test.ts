import test from "node:test";
import assert from "node:assert/strict";
import { EditorState, Compartment } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { config } from "../../../src/plugins/editor/manifest";
import {
  editorSettings,
  settingsExtensions,
} from "../../../src/plugins/editor/settings";
import { readSettings } from "../../../src/host/settings";
import type { SettingsReader } from "../../../src/host/settings";
import { createRenderer } from "../../../src/markdown/html";
import { contributions } from "../../../scripts/contributions";

/** The CSS custom properties the settings' editor theme declares. */
function fontDeclarations(extensions: Extension): Record<string, string> {
  const rules = EditorState.create({ extensions })
    .facet(EditorView.styleModule)
    .map((module) => module.getRules())
    .join("\n");
  return Object.fromEntries(
    [...rules.matchAll(/(--[a-z-]+):\s*([^;}]+)/g)].map((match) => [
      match[1]!,
      match[2]!.trim(),
    ]),
  );
}

test("editor settings have application defaults and reconfigure without changing text or selection", () => {
  assert.deepEqual(config.parse({}), {
    defaultMode: "livePreview",
    // Off by default: text fills the editor like VS Code's text editor.
    readableLineLength: false,
    // Auto: reclaims Cursor's text-editor switch only when running in Cursor.
    reclaimTextEditor: "auto",
    // Off: in-place workbench→text (Claude) stays native unless opted in.
    reclaimInPlaceTextEditor: false,
    // Auto: materialize TextDocuments early so Cursor can open our custom editor.
    warmTextDocument: "auto",
    // On: the page's first HTML draws the note's first screen.
    firstPaintSnapshot: true,
    strictLineBreaks: false,
    rightToLeft: false,
    dragScrollSpeed: 4,
    // On: an open note is saved 2 s after its last edit, as in Obsidian.
    autosave: true,
    useTabs: true,
    tabSize: 4,
    // The note's own size: Obsidian's default body size, not editor.fontSize.
    fontSize: 16,
    // Its line height: Obsidian's 1.5, a multiple of the size.
    lineHeight: 1.5,
    // Native editor font settings for Markdown; empty until the host reads them.
    fontFamily: "",
    fontFamilyExplicit: false,
    defaultFontFamily: "",
    fontWeight: "normal",
    letterSpacing: 0,
    fontLigatures: false,
    fontVariations: false,
    cursorStyle: "line",
    cursorBlinking: "blink",
    cursorSmoothCaretAnimation: "off",
    cursorWidth: 0,
    // VS Code's files.autoSave until the host reads it: off.
    filesAutoSave: "off",
  });
  // VS Code's defaults: ligatures off, no variations; Obsidian's body size.
  assert.deepEqual(fontDeclarations(settingsExtensions({})), {
    "--text-size": "16px",
    "--text-weight": "normal",
    "--line-height": "1.5",
    "--text-features": '"liga" off, "calt" off',
    "--text-variations": "normal",
  });
  const compartment = new Compartment();
  let state = EditorState.create({
    doc: "one\ntwo",
    selection: { anchor: 2 },
    extensions: compartment.of(settingsExtensions({})),
  });
  assert.deepEqual(state.facet(EditorView.editorAttributes).at(-1), {
    dir: "ltr",
  });
  assert.deepEqual(
    EditorState.create({
      extensions: settingsExtensions({ readableLineLength: true }),
    })
      .facet(EditorView.editorAttributes)
      .at(-1),
    { dir: "ltr", class: "is-readable-line-width" },
  );
  const previous = state;
  state = state.update({
    effects: compartment.reconfigure(
      settingsExtensions({
        rightToLeft: true,
        readableLineLength: false,
        strictLineBreaks: true,
        dragScrollSpeed: 7,
      }),
    ),
  }).state;
  assert.equal(state.doc, previous.doc);
  assert.equal(state.selection, previous.selection);
  assert.equal(state.facet(editorSettings).strictLineBreaks, true);
  assert.equal(state.facet(editorSettings).dragScrollSpeed, 7);
  assert.deepEqual(state.facet(EditorView.editorAttributes).at(-1), {
    dir: "rtl",
  });
});

test("caret settings come from native Markdown configuration and survive settings reconfiguration", async () => {
  const markdown: Record<string, unknown> = {
    "editor.cursorStyle": "block-outline",
    "editor.cursorBlinking": "expand",
    "editor.cursorSmoothCaretAnimation": "explicit",
    "editor.cursorWidth": 4,
  };
  const reader: SettingsReader = {
    get: <T>(_key: string, fallback?: T) => fallback,
  };
  const native: SettingsReader = {
    get: <T>(key: string) => markdown[key] as T,
  };
  const settings = readSettings(reader, native).editor!;
  assert.deepEqual(
    [
      settings.cursorStyle,
      settings.cursorBlinking,
      settings.cursorSmoothCaretAnimation,
      settings.cursorWidth,
    ],
    ["block-outline", "expand", "explicit", 4],
  );
  const compartment = new Compartment();
  const state = EditorState.create({
    doc: "abc",
    selection: { anchor: 1 },
    extensions: compartment.of(settingsExtensions({})),
  });
  const updated = state.update({
    effects: compartment.reconfigure(settingsExtensions(settings)),
  }).state;
  assert.equal(updated.doc, state.doc);
  assert.equal(updated.selection, state.selection);
  assert.equal(updated.facet(editorSettings).cursorWidth, 4);
  assert.equal(updated.facet(editorSettings).cursorBlinking, "expand");
  const generated = await contributions();
  for (const key of Object.keys(generated.configuration.properties)) {
    assert.ok(!key.startsWith("lumiere.markdown.editor.cursor"), key);
  }
});
test("autosave is our setting; files.autoSave is VS Code's, read for Markdown and not contributed again", async () => {
  const reader: SettingsReader = {
    get: <T>(key: string, fallback?: T) =>
      (key === "editor.autosave" ? false : fallback) as T,
  };
  const nativeValue = (value: unknown): SettingsReader => ({
    get: <T>(key: string) =>
      (key === "files.autoSave" ? value : undefined) as T,
  });
  const editor = readSettings(reader, nativeValue("afterDelay")).editor!;
  assert.equal(editor.autosave, false);
  assert.equal(editor.filesAutoSave, "afterDelay");
  assert.equal(readSettings(reader).editor?.filesAutoSave, "off");
  // A hand-edited value VS Code would ignore does not stop the editor opening.
  assert.equal(
    readSettings(reader, nativeValue("sometimes")).editor?.filesAutoSave,
    "off",
  );
  const generated = await contributions();
  const properties = Object.keys(generated.configuration.properties);
  assert.ok(properties.includes("lumiere.markdown.editor.autosave"));
  assert.ok(!properties.some((key) => key.endsWith("filesAutoSave")));
});
test("resource settings use manifest aliases and validate all editor fields", () => {
  const values: Record<string, unknown> = {
    "files.newNoteFolder": "notes",
    "files.attachmentFolder": "./media",
    "editor.rightToLeft": true,
    "editor.dragScrollSpeed": 2.5,
    "editor.defaultMode": "source",
    "plugins.vim.enabled": true,
  };
  const reader: SettingsReader = {
    get: <T>(key: string, fallback?: T) =>
      key in values ? (values[key] as T) : fallback,
  };
  const result = readSettings(reader);
  assert.equal(result.features?.links?.config.newNoteFolder, "notes");
  assert.equal(result.features?.links?.config.attachmentFolder, "./media");
  assert.equal(result.features?.vim?.enabled, true);
  assert.equal(result.editor?.rightToLeft, true);
  assert.equal(result.editor?.dragScrollSpeed, 2.5);
  assert.equal(result.mode, "source");
  assert.equal(result.features?.lineNumbers?.enabled, true);
  assert.equal(result.features?.inlineTitle?.enabled, false);
  assert.equal(result.features?.lineNumbers?.config.style, "on");
  values["editor.rightToLeft"] = "yes";
  assert.throws(() => readSettings(reader));
});
test("strict line breaks are per-render and do not leak to later requests", () => {
  const renderer = createRenderer();
  assert.match(renderer.renderMarkdown("one\ntwo"), /<br>/);
  assert.doesNotMatch(
    renderer.renderMarkdown("one\ntwo", { strictLineBreaks: true }),
    /<br>/,
  );
  assert.match(renderer.renderMarkdown("one\ntwo"), /<br>/);
});
test("required settings, title actions, native context menus and unbound verify commands are generated", async () => {
  const generated = await contributions();
  const properties = generated.configuration.properties as Record<
    string,
    { default: unknown; scope: string }
  >;
  for (const [key, value] of Object.entries({
    // Deliberately not Obsidian 1.15.0's defaults (readable line length on,
    // inline title on, line numbers off): DESIGN §15.3, owner decision #689.
    "editor.readableLineLength": false,
    "editor.strictLineBreaks": false,
    "editor.rightToLeft": false,
    "editor.dragScrollSpeed": 4,
    "editor.autosave": true,
    "files.attachmentFolder": "",
    "files.newNoteFolder": "",
    "links.useWikilinks": true,
    "plugins.lineNumbers.enabled": true,
    // Off by default: line 1 starts at the top, as in the text editor.
    "plugins.inlineTitle.enabled": false,
    "plugins.diagrams.enabled": true,
    "plugins.vim.enabled": false,
  })) {
    assert.deepEqual(
      [
        properties[`lumiere.markdown.${key}`]?.default,
        properties[`lumiere.markdown.${key}`]?.scope,
      ],
      [value, "resource"],
      key,
    );
  }
  assert.deepEqual(
    generated.menus["editor/title"].map((menu) => menu.command).sort(),
    [
      "lumiere.markdown.addProperty",
      "lumiere.markdown.jumpBack",
      "lumiere.markdown.jumpForward",
      "lumiere.markdown.openAsText",
      "lumiere.markdown.titleActions",
    ],
  );
  assert.ok(
    generated.menus["webview/context"].some(
      (menu) => menu.submenu === "lumiere.markdown.menu.format",
    ),
  );
  assert.ok(
    generated.menus["lumiere.markdown.menu.format"]?.some(
      (menu) =>
        menu.command === "lumiere.markdown.toggleBold" &&
        menu.when.includes("markdownContent"),
    ),
  );
  // Obsidian 1.15.0 binds no key to these.
  for (const id of [
    "toggleStrikethrough",
    "toggleHighlight",
    "toggleCode",
    "cycleListChecklist",
  ]) {
    assert.ok(
      !generated.keybindings.some(
        (binding) => binding.command === `lumiere.markdown.${id}`,
      ),
      id,
    );
  }
});

test("Obsidian 1.15.0's default editor keys are bound where VS Code and Cursor leave them free", async () => {
  const { keybindings } = await contributions();
  const keysOf = (id: string) =>
    keybindings
      .filter((binding) => binding.command === `lumiere.markdown.${id}`)
      .map((binding) => [binding.key, binding.mac, binding.when]);
  const note = "activeCustomEditorId == 'lumiere.markdown.editor'";
  for (const [id, key, mac, plugin] of [
    ["toggleComment", "ctrl+/", "cmd+/", "formatting"],
    // Follow Link, Open Link in New Tab and Open Link to Side (owner
    // decision, 2026-11-21; Alt+Enter was Page Preview's key before).
    ["followLink", "alt+enter", undefined, "links"],
    ["openLinkInNewTab", "ctrl+enter", "cmd+enter", "links"],
    ["openLinkToSide", "ctrl+alt+enter", "cmd+alt+enter", "links"],
  ] as const) {
    assert.deepEqual(
      keysOf(id),
      [
        [
          key,
          mac,
          `${note} && lumiere.markdown.plugin.${plugin} && lumiere.markdown.editorFocus`,
        ],
      ],
      id,
    );
  }
  // Cursor opens its chat with Cmd/Ctrl+L (through the Cursor bridge).
  assert.deepEqual(keysOf("toggleChecklist"), [
    [
      "ctrl+l",
      "cmd+l",
      `${note} && lumiere.markdown.plugin.tasks && !lumiere.markdown.isCursorHost && lumiere.markdown.editorFocus`,
    ],
  ]);
  // Clashes left unbound (CAPABILITIES.md, "Hotkeys"): Mod+O is VS Code's
  // Open File, Mod+D its Add Selection to Next Find Match, Mod+E Lumiere's
  // Toggle Text Editor. Page Preview has no key: Alt+Enter is Follow Link's.
  for (const id of [
    "quickSwitcher",
    "deleteParagraph",
    "toggleSourceMode",
    "previewLink",
  ]) {
    assert.deepEqual(keysOf(id), [], id);
  }
  for (const chord of ["ctrl+o", "ctrl+d"]) {
    assert.ok(
      !keybindings.some(
        (binding) =>
          binding.key === chord &&
          binding.command.startsWith("lumiere.markdown.") &&
          // Vim's Control keys, which the vim plugin consumes on purpose.
          !/Vim/.test(binding.command) &&
          // The quick switcher's own keys, live only inside its quick pick.
          !binding.when?.includes("inQuickOpen"),
      ),
      chord,
    );
  }
  // Obsidian's switcher keys: Mod+Enter, Mod+Alt+Enter, Shift+Enter and
  // Mod+Shift+Enter, only while Lumiere's quick switcher is open.
  for (const [id, key] of [
    ["quickSwitcher.openInNewTab", "ctrl+enter"],
    ["quickSwitcher.openToSide", "ctrl+alt+enter"],
    ["quickSwitcher.create", "shift+enter"],
    ["quickSwitcher.createInNewTab", "ctrl+shift+enter"],
  ] as const) {
    const [binding] = keysOf(id);
    assert.equal(binding?.[0], key, id);
    assert.ok(
      binding?.[2]?.endsWith(
        "inQuickOpen && lumiere.markdown.quickSwitcherOpen",
      ),
      id,
    );
  }
});

test("manual and parity inventories include every generated command, submenu and setting", async () => {
  const { readFileSync } = await import("node:fs");
  const generated = await contributions();
  const manual = readFileSync("docs/MANUAL_TEST_PLAN.md", "utf8");
  const parity = readFileSync("docs/PARITY.md", "utf8");
  for (const id of [
    ...generated.commands.map((command) => command.command),
    ...generated.submenus.map((submenu) => submenu.id),
    ...Object.keys(generated.configuration.properties),
  ]) {
    assert.ok(manual.includes(id), `manual: ${id}`);
    assert.ok(parity.includes(id), `parity: ${id}`);
  }
  assert.equal(
    generated.menus.commandPalette.find(
      (menu) => menu.command === "lumiere.markdown.consumeVimHostShortcut",
    )?.when,
    "false",
  );
});
test("line numbers follow the native editor.lineNumbers setting, which is not contributed again", async () => {
  const reader: SettingsReader = {
    get: <T>(_key: string, fallback?: T) => fallback,
  };
  for (const style of ["on", "off", "relative", "interval"]) {
    const native: SettingsReader = {
      get: <T>(key: string) =>
        (key === "editor.lineNumbers" ? style : undefined) as T,
    };
    assert.equal(
      readSettings(reader, native).features?.lineNumbers?.config.style,
      style,
    );
  }
  const generated = await contributions();
  assert.ok(
    !Object.keys(generated.configuration.properties).some((key) =>
      key.startsWith("lumiere.markdown.lineNumbers."),
    ),
  );
});

test("agent commands copy a reference or open a reference the user already copied", async () => {
  const generated = await contributions();
  const settings = Object.keys(generated.configuration.properties);
  assert.ok(settings.includes("lumiere.markdown.plugins.agentBridge.enabled"));
  assert.equal(
    settings.some((key) => key.includes("copyForAgent")),
    false,
  );
  const commands = generated.commands.map((command) => command.command);
  assert.ok(commands.includes("lumiere.markdown.copyLinkForAgent"));
  // A bare copyForAgent command would look like it starts an agent.
  assert.equal(commands.includes("lumiere.markdown.copyForAgent"), false);
  assert.deepEqual(
    generated.commands
      .filter((command) => /agent/i.test(command.command))
      .map((command) => command.title),
    ["Copy link to this", "Open Copied Agent Reference"],
  );
  assert.equal(
    settings.some((key) => key.includes("askAgent")),
    false,
  );
  assert.equal(
    generated.keybindings.some((binding) =>
      binding.command.endsWith(".copyForAgent"),
    ),
    false,
  );
  for (const menus of Object.values(generated.menus)) {
    assert.equal(
      menus.some((menu) => menu.command?.endsWith(".copyForAgent")),
      false,
    );
  }
});

test("note text follows the native editor font settings for Markdown files (not its size, which is lumiere.markdown.editor.fontSize)", async () => {
  // What VS Code returns for a Markdown file, [markdown] overrides included.
  const markdown: Record<string, unknown> = {
    "editor.fontFamily": "Fira Code",
    // Ignored: the note has its own size.
    "editor.fontSize": 30,
    "editor.fontWeight": "300",
    // Ignored: the note has its own line height.
    "editor.lineHeight": 27,
    "editor.letterSpacing": 0.5,
    "editor.fontLigatures": true,
    "editor.fontVariations": false,
    "editor.fontFamily#default": "'Droid Sans Mono', monospace",
  };
  const native: SettingsReader = {
    get: <T>(key: string) => markdown[key] as T,
  };
  const own: SettingsReader = {
    get: <T>(key: string, fallback?: T) =>
      key === "editor.fontSize"
        ? (18 as T)
        : key === "editor.lineHeight"
          ? (1.8 as T)
          : fallback,
  };
  const editor = readSettings(own, native).editor!;
  assert.deepEqual(
    [
      editor.fontFamily,
      editor.fontSize,
      editor.fontWeight,
      editor.lineHeight,
      editor.letterSpacing,
      editor.fontLigatures,
      editor.fontVariations,
    ],
    ["Fira Code", 18, "300", 1.8, 0.5, true, false],
  );
  assert.deepEqual(fontDeclarations(settingsExtensions(editor)), {
    "--text-font": `"Fira Code", 'Droid Sans Mono', monospace`,
    "--code-font": `"Fira Code", 'Droid Sans Mono', monospace`,
    "--text-size": "18px",
    "--text-weight": "300",
    "--line-height": "1.8",
    "--text-letter-spacing": "0.5px",
    "--text-features": '"liga" on, "calt" on',
    "--text-variations": "normal",
  });
  // Without a setting it is Obsidian's 1.5, whatever editor.lineHeight is.
  assert.equal(
    readSettings({ get: <T>(_key: string, fallback?: T) => fallback }, native)
      .editor!.lineHeight,
    1.5,
  );
  // A hand-edited settings.json with a wrong type does not break the editor.
  markdown["editor.fontLigatures"] = 3;
  const wrongSize: SettingsReader = {
    get: <T>(key: string, fallback?: T) =>
      key === "editor.fontSize" ? ("big" as T) : fallback,
  };
  const fallback = readSettings(wrongSize, native).editor!;
  assert.equal(fallback.fontSize, 16);
  assert.equal(fallback.fontLigatures, false);
  const generated: Record<string, unknown> = (await contributions())
    .configuration.properties;
  // Only the size and line height are contributed; the other font fields are native settings.
  assert.deepEqual(
    Object.keys(generated).filter((key) =>
      /\.(font|lineHeight|letterSpacing)/.test(key),
    ),
    ["lumiere.markdown.editor.fontSize", "lumiere.markdown.editor.lineHeight"],
  );
  assert.deepEqual(
    {
      ...(generated["lumiere.markdown.editor.fontSize"] as object),
      description: undefined,
    },
    {
      type: "number",
      minimum: 8,
      maximum: 48,
      default: 16,
      scope: "resource",
      description: undefined,
    },
  );
  assert.deepEqual(
    {
      ...(generated["lumiere.markdown.editor.lineHeight"] as object),
      description: undefined,
    },
    {
      type: "number",
      minimum: 1,
      maximum: 3,
      default: 1.5,
      scope: "resource",
      description: undefined,
    },
  );
});
