import assert from "node:assert/strict";
import test from "node:test";
import {
  expandTemplate,
  expandTemplateWithReport,
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

test("Moment's common tokens are written as Moment writes them", () => {
  const cases: [string, string][] = [
    ["dddd, MMMM Do YYYY", "Thursday, November 5th 2026"],
    ["ddd MMM D, YY", "Thu Nov 5, 26"],
    ["h:mm A", "9:07 AM"],
    ["hh:mm a", "09:07 am"],
    ["YYYY-MM-DDTHH:mm", "2026-11-05T09:07"],
    ["[Week] W, GGGG", "Week 45, 2026"],
    ["DDDD DDD Q E d dd", "309 309 4 4 4 Th"],
    ["YYYY年MM月DD日", "2026年11月05日"],
    ["LL", "November 5, 2026"],
    ["[MMMM] MMMM", "MMMM November"],
  ];
  for (const [format, expected] of cases) {
    assert.equal(formatLocalDate(NOW, format), expected, format);
    assert.equal(isSupportedDateFormat(format), true, format);
  }
  assert.equal(formatLocalDate(new Date(2027, 0, 1), "GGGG-[W]WW"), "2026-W53");
  assert.deepEqual(
    [1, 2, 3, 4, 11, 12, 13, 21, 22, 23].map((day) =>
      formatLocalDate(new Date(2026, 0, day), "Do"),
    ),
    [
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "23rd",
    ],
  );
});

test("tokens Lumiere cannot write are reported and written as they are", () => {
  for (const format of ["", "  ", "gggg-[W]ww", "YYYYYY", "N", "zz"]) {
    assert.equal(isSupportedDateFormat(format), false, format);
  }
  const { text, unsupported } = expandTemplateWithReport(
    "{{date:gggg [w]w}} {{time}}",
    { title: "T", now: NOW },
  );
  assert.equal(text, "gggg ww 09:07");
  assert.deepEqual(unsupported, ["gggg", "w"]);
  assert.deepEqual(
    expandTemplateWithReport("{{date:dddd}}", { title: "T", now: NOW })
      .unsupported,
    [],
  );
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
