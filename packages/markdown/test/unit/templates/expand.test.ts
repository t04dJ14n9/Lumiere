import assert from "node:assert/strict";
import test from "node:test";
import {
  expandTemplate,
  formatLocalDate,
  isSupportedDateFormat,
} from "../../../src/markdown/templates";
import {
  templateFiles,
  templateFolder,
  templatePickItems,
} from "../../../src/plugins/templates/list";
import type { VaultFile } from "../../../src/plugins/vault/api";

// Local wall-clock time: 2026-11-05 09:07:03, whatever the test machine's zone.
const NOW = new Date(2026, 10, 5, 9, 7, 3);

test("expands title, date and time with the default formats", () => {
  assert.equal(
    expandTemplate("# {{title}}\n{{date}} {{time}}", {
      title: "Plan",
      now: NOW,
    }),
    "# Plan\n2026-11-05 09:07",
  );
});

test("configured formats apply to bare tokens; inline formats win", () => {
  const context = {
    title: "Plan",
    now: NOW,
    dateFormat: "DD/MM/YYYY",
    timeFormat: "HH.mm.ss",
  };
  assert.equal(
    expandTemplate("{{date}} {{time}} {{date:YYYYMMDD}} {{time:HH}}", context),
    "05/11/2026 09.07.03 20261105 09",
  );
});

test("empty configured formats fall back to the defaults", () => {
  assert.equal(
    expandTemplate("{{date}} {{time}}", {
      title: "",
      now: NOW,
      dateFormat: "",
      timeFormat: "",
    }),
    "2026-11-05 09:07",
  );
});

test("unknown tokens, a formatted title and broken braces stay as written", () => {
  const text = "{{author}} {{title:X}} {{date {date}} {{ date }}";
  assert.equal(expandTemplate(text, { title: "T", now: NOW }), text);
});

test("formatLocalDate writes local time, not UTC", () => {
  assert.equal(
    formatLocalDate(NOW, "YYYY-MM-DD HH:mm:ss"),
    "2026-11-05 09:07:03",
  );
});

test("only formats made of supported tokens are supported", () => {
  for (const format of [
    "YYYY-MM-DD",
    "YYYY/MM/YYYY-MM-DD",
    "HH:mm",
    "DD.MM.YYYY",
  ]) {
    assert.equal(isSupportedDateFormat(format), true, format);
  }
  for (const format of [
    "",
    "  ",
    "YYYY-MM-DD dddd",
    "Do MMMM",
    "[Week] W",
    "YY",
  ]) {
    assert.equal(isSupportedDateFormat(format), false, format);
  }
});

function file(path: string): VaultFile {
  const name = path.split("/").pop()!;
  const dot = name.lastIndexOf(".");
  return {
    path,
    basename: name.slice(0, dot),
    extension: name.slice(dot + 1),
    mtime: 0,
    size: 0,
    uri: `file:///vault/${path}`,
  };
}

test("template folder is a vault path; unset or escaping folders are refused", () => {
  assert.equal(templateFolder(" /Templates/ "), "Templates");
  assert.equal(templateFolder(""), undefined);
  assert.equal(templateFolder("../outside"), undefined);
});

test("lists Markdown files under the folder, sorted, named inside it", () => {
  const files = templateFiles(
    [
      file("Templates/Weekly.md"),
      file("Templates/meetings/Standup.md"),
      file("Templates/logo.png"),
      file("TemplatesOld/Daily.md"),
      file("Notes/Daily.md"),
    ],
    "Templates",
  );
  assert.deepEqual(
    files.map((item) => item.path),
    ["Templates/meetings/Standup.md", "Templates/Weekly.md"],
  );
  assert.deepEqual(
    templatePickItems(files, "Templates", "").map((item) => item.label),
    ["meetings/Standup", "Weekly"],
  );
  assert.deepEqual(
    templatePickItems(files, "Templates", "WEEK").map((item) => item.label),
    ["Weekly"],
  );
});
