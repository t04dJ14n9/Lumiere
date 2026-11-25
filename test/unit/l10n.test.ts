import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  collectMessages,
  compareTranslations,
  placeholders,
} from "../../scripts/l10n";
import { externalize } from "../../scripts/manifest-nls";

function source(text: string): string {
  const dir = mkdtempSync(join(tmpdir(), "lumiere-l10n-"));
  const file = join(dir, "a.ts");
  writeFileSync(file, text);
  return file;
}

test("every literal t() message is collected, under any import name; a computed one is an error", () => {
  const file = source(
    [
      'import { t as tr } from "@workshop/l10n";',
      'import { t } from "../../l10n/src/l10n";',
      'tr("Open");',
      't("Page {0}", 2);',
      "t(`Page`);",
      "t(name);",
      'other("Not this");',
    ].join("\n"),
  );
  const { messages, errors } = collectMessages([file]);
  assert.deepEqual([...messages.keys()].sort(), ["Open", "Page", "Page {0}"]);
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /a\.ts:6: t\(\) needs its message as a literal/u);
});

test("a file that does not import the translator is not read for messages", () => {
  const file = source('const t = (s: string) => s;\nt("l10n");');
  assert.equal(collectMessages([file]).messages.size, 0);
});

test("a translation must cover every message, keep its placeholders, and drop unused ones", () => {
  const english = new Map(
    ["Open", "Page {0} of {1}", "Close"].map((text) => [text, text]),
  );
  assert.deepEqual(
    compareTranslations("zh-cn", english, {
      Open: "打开",
      "Page {0} of {1}": "第 {0} 页",
      Gone: "已删除",
    }),
    [
      'zh-cn: "Page {0} of {1}" has placeholders {0}, not {0},{1}',
      'zh-cn: no translation for "Close"',
      'zh-cn: "Gone" is no longer used',
    ],
  );
  assert.equal(placeholders("{1} then {0} and {0}"), "{0},{1}");
});

test("the manifest's text becomes %key% placeholders, its English in package.nls.json", () => {
  const { contributes, nls } = externalize({
    commands: [
      { command: "x.open", title: "Open", category: "Lumiere", icon: "$(go)" },
    ],
    configuration: [
      {
        title: "Lumiere",
        properties: {
          "x.mode": {
            type: "string",
            enum: ["a", "b"],
            enumDescriptions: ["First", "Second"],
            markdownDescription: "Use `a`.",
          },
        },
      },
    ],
    views: { explorer: [{ id: "x.outline", name: "Outline" }] },
    viewsWelcome: [{ view: "x.outline", contents: "Loading…" }],
    submenus: [{ id: "x.more", label: "More" }],
    customEditors: [{ viewType: "x.pdf", displayName: "PDF Reader" }],
    keybindings: [{ command: "x.open", key: "ctrl+o" }],
  });
  assert.deepEqual(contributes.commands, [
    {
      command: "x.open",
      title: "%command.x.open.title%",
      category: "Lumiere",
      icon: "$(go)",
    },
  ]);
  const properties = (contributes.configuration as never[])[0]![
    "properties"
  ] as Record<string, Record<string, unknown>>;
  assert.deepEqual(properties["x.mode"], {
    type: "string",
    enum: ["a", "b"],
    enumDescriptions: [
      "%config.x.mode.enumDescriptions.0%",
      "%config.x.mode.enumDescriptions.1%",
    ],
    markdownDescription: "%config.x.mode.markdownDescription%",
  });
  assert.deepEqual(contributes.keybindings, [
    { command: "x.open", key: "ctrl+o" },
  ]);
  assert.deepEqual(nls, {
    "command.x.open.title": "Open",
    "config.x.mode.enumDescriptions.0": "First",
    "config.x.mode.enumDescriptions.1": "Second",
    "config.x.mode.markdownDescription": "Use `a`.",
    "customEditor.x.pdf.displayName": "PDF Reader",
    "submenu.x.more.label": "More",
    "view.x.outline.name": "Outline",
    "viewsWelcome.x.outline.0.contents": "Loading…",
  });
});

test("the extension manifest names its localization files and ships them", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  ) as { l10n: string };
  assert.equal(manifest.l10n, "./l10n");
  const ignore = readFileSync(
    new URL("../../.vscodeignore", import.meta.url),
    "utf8",
  );
  assert.match(ignore, /^!package\.nls\*\.json$/mu);
  assert.match(ignore, /^!l10n\/bundle\.l10n\.\*\.json$/mu);
});
