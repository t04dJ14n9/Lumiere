import assert from "node:assert/strict";
import type * as NodeFsPromises from "node:fs/promises";
import { createRequire } from "node:module";
import * as path from "node:path";
import { afterEach, beforeEach, mock, test } from "node:test";
// First: everything below imports 'vscode', which this points at the fake.
import "./support/install-fake-vscode";
import * as vscode from "./support/fake-vscode";
import { OPEN_LOCATION_COMMAND_ID } from "../../src/shared/command-ids";
import { PdfBacklinkIndex } from "../../src/shared/pdf-backlink-index";
import { workspacePdfFiles } from "../../src/extension/outlines/vscode";
import { flattenOutline } from "../../src/extension/plugins/agentBridge/mcp/tools/pdf-info";
import {
  callTool,
  fakeDeps,
  fakePanels,
  withClient,
} from "./support/bridge-tools";
import {
  installWorkspace,
  type WorkspaceFixture,
} from "./support/workspace-fixture";

/**
 * The PDF tools, through a real MCP client over a real workspace folder:
 * which PDFs a path argument may name, and what each tool answers.
 */

let workspace: WorkspaceFixture;
let opened: unknown[][];
const executeCommand = vscode.commands.executeCommand;

beforeEach(async () => {
  workspace = await installWorkspace();
  opened = [];
});
afterEach(async () => {
  vscode.commands.executeCommand = executeCommand;
  await workspace.remove();
});

/** Record the Open Location command instead of running it; `result` is what it answers. */
function recordOpen(result: boolean): void {
  vscode.commands.executeCommand = (async (...args: unknown[]) => {
    opened.push(args);
    return result;
  }) as never;
}

/** A viewer the tools can read: its file, and what it has reported. */
function fakePanel(relative: string, extra: Record<string, unknown> = {}) {
  return {
    uri: workspace.uri(relative),
    view: { page: 3, pageCount: 12, zoomPercent: 110 },
    outline: undefined,
    sha256: "ab".repeat(32),
    selectionSnapshot: () => undefined,
    ...extra,
  };
}

const OUTSIDE_MESSAGE = /inside this window's workspace folders/u;

test("open_pdf_location opens a workspace PDF at its page, without taking the focus", async () => {
  recordOpen(true);
  const answer = await callTool(fakeDeps(), "open_pdf_location", {
    link: "papers/a.pdf#page=3&viewrect=72,83,134,21",
  });
  assert.equal(answer.isError, false, answer.text);
  assert.equal(answer.text, "Opened papers/a.pdf at page 3.");
  assert.equal(opened.length, 1);
  const [id, target, location, options] = opened[0]!;
  assert.equal(id, OPEN_LOCATION_COMMAND_ID);
  assert.equal(
    String(target),
    workspace
      .uri("papers/a.pdf")
      .with({ fragment: "page=3&viewrect=72,83,134,21" })
      .toString(),
  );
  assert.equal(location, undefined);
  assert.deepEqual(options, { preserveFocus: true });
});

test("open_pdf_location takes a Markdown link, a locator, an absolute path and says when no page was given", async () => {
  recordOpen(true);
  const deps = fakeDeps();
  const absolute = path.join(workspace.root, "papers", "b.pdf");
  const texts = [
    (
      await callTool(deps, "open_pdf_location", {
        link: "[p. 2](papers/a.pdf#page=2)",
      })
    ).text,
    (
      await callTool(deps, "open_pdf_location", {
        link: "@papers/a.pdf#page=5",
      })
    ).text,
    (await callTool(deps, "open_pdf_location", { link: absolute })).text,
  ];
  assert.deepEqual(texts, [
    "Opened papers/a.pdf at page 2.",
    "Opened papers/a.pdf at page 5.",
    "Opened papers/b.pdf (no page given, so it is at the page it was on).",
  ]);
});

test("open_pdf_location refuses what is not a PDF inside the workspace, and never runs the command", async () => {
  recordOpen(true);
  const deps = fakeDeps();
  const outsideLink = path.join(workspace.root, "..", "outside.pdf");
  const refused = [
    workspace.outside, // absolute, beside the workspace
    "../outside.pdf", // relative, out through `..`
    outsideLink, // absolute, out through `..`
    `${vscode.Uri.file(workspace.outside).toString()}#page=1`, // a URI
    "papers/escape.pdf", // inside by name, a link to a file outside
    "papers/notes.txt", // not a PDF
    "papers/archive.pdf", // a folder named like one
    "papers/missing.pdf", // not there
    "/etc/hosts",
  ];
  for (const link of refused) {
    const answer = await callTool(deps, "open_pdf_location", { link });
    assert.equal(answer.isError, true, link);
    assert.match(answer.text, OUTSIDE_MESSAGE, link);
  }
  assert.deepEqual(opened, []);
});

test("an outside PDF is refused with the answer for a missing one, so a path cannot probe the disk", async () => {
  recordOpen(true);
  const deps = fakeDeps();
  const outside = await callTool(deps, "open_pdf_location", {
    link: workspace.outside,
  });
  const missing = await callTool(deps, "open_pdf_location", {
    link: path.join(path.dirname(workspace.outside), "missing.pdf"),
  });
  assert.equal(
    outside.text.replace(workspace.outside, "X"),
    missing.text.replace(
      path.join(path.dirname(workspace.outside), "missing.pdf"),
      "X",
    ),
  );
});

test("a network-location argument is refused before any file-system call, so no host is contacted", async () => {
  recordOpen(true);
  const deps = fakeDeps();
  // The module object the source calls into, not an import's copy of it.
  const fsPromises: typeof NodeFsPromises = createRequire(import.meta.url)(
    "node:fs/promises",
  );
  const stat = mock.method(workspacePdfFiles, "stat");
  const realpath = mock.method(fsPromises, "realpath");
  try {
    // The control: a PDF inside the workspace does reach both calls, so zero below means none were made.
    const inside = await callTool(deps, "open_pdf_location", {
      link: "papers/a.pdf",
    });
    assert.equal(inside.isError, false, inside.text);
    // This machine's file as a file:/// URI is still allowed.
    const byUri = await callTool(deps, "open_pdf_location", {
      link: workspace.uri("papers/a.pdf").toString(),
    });
    assert.equal(byUri.isError, false, byUri.text);
    assert.ok(stat.mock.callCount() > 0, "the stat spy sees the calls");
    assert.ok(realpath.mock.callCount() > 0, "the realpath spy sees the calls");
    stat.mock.resetCalls();
    realpath.mock.resetCalls();
    const network = [
      "\\\\server\\share\\papers\\a.pdf", // a UNC path
      "//server/share/papers/a.pdf", // the same, with slashes
      "file://server/share/papers/a.pdf", // a file URI with a host
      "file:////server/share/papers/a.pdf", // a file URI with a UNC path
      "%5C%5Cserver%5Cshare%5Cpapers%5Ca.pdf", // a UNC path, percent-encoded
      "%5C%5Cserver%5Cshare%5Cpapers%5Ca.pdf#page=%", // the same, a bad fragment
      "file:\\\\server\\share\\papers\\a.pdf", // a file URI, backslashes
      "\\\\?\\UNC\\server\\share\\papers\\a.pdf", // a UNC path in device form
      "\\\\.\\UNC\\server\\share\\papers\\a.pdf", // the same, the other device form
    ];
    for (const link of network) {
      const answer = await callTool(deps, "open_pdf_location", { link });
      assert.equal(answer.isError, true, link);
      assert.match(answer.text, OUTSIDE_MESSAGE, link);
    }
    assert.equal(stat.mock.callCount(), 0, "no stat");
    assert.equal(realpath.mock.callCount(), 0, "no realpath");
    assert.equal(opened.length, 2, "only the two controls opened");
  } finally {
    stat.mock.restore();
    realpath.mock.restore();
  }
});

test("a device-namespace or localhost name is this machine's, so it reaches the file system", async () => {
  recordOpen(true);
  const deps = fakeDeps();
  const stat = mock.method(workspacePdfFiles, "stat");
  try {
    for (const link of [
      "\\\\?\\C:\\papers\\a.pdf",
      "\\\\.\\C:\\papers\\a.pdf",
      "file://localhost/papers/a.pdf",
    ]) {
      stat.mock.resetCalls();
      await callTool(deps, "open_pdf_location", { link });
      assert.ok(stat.mock.callCount() > 0, `${link} reaches stat`);
    }
  } finally {
    stat.mock.restore();
  }
});

test("a workspace on a share keeps that share's paths, and no other host's", async () => {
  recordOpen(true);
  const deps = fakeDeps();
  const stat = mock.method(workspacePdfFiles, "stat");
  const original = vscode.workspace.workspaceFolders;
  try {
    vscode.workspace.workspaceFolders = [
      { uri: vscode.Uri.parse("file://server/share/proj") },
    ];
    await callTool(deps, "open_pdf_location", {
      link: "\\\\server\\share\\proj\\papers\\a.pdf",
    });
    assert.ok(
      stat.mock.callCount() > 0,
      "the workspace's own host reaches stat",
    );

    stat.mock.resetCalls();
    await callTool(deps, "open_pdf_location", {
      link: "\\\\other\\share\\papers\\a.pdf",
    });
    assert.equal(stat.mock.callCount(), 0, "another host does not");

    vscode.workspace.workspaceFolders = [
      { uri: vscode.Uri.parse("vscode-vfs://server/proj") },
    ];
    stat.mock.resetCalls();
    await callTool(deps, "open_pdf_location", {
      link: "\\\\server\\share\\proj\\papers\\a.pdf",
    });
    assert.equal(
      stat.mock.callCount(),
      0,
      "a folder that is not a file folder owns no host",
    );
  } finally {
    vscode.workspace.workspaceFolders = original;
    stat.mock.restore();
  }
});

test("open_pdf_location refuses an invalid page and says when the editor did not open it", async () => {
  recordOpen(false);
  const deps = fakeDeps();
  const invalid = await callTool(deps, "open_pdf_location", {
    link: "papers/a.pdf#page=0",
  });
  assert.equal(invalid.isError, true);
  assert.match(invalid.text, /location is invalid/u);
  assert.deepEqual(opened, []);
  const failed = await callTool(deps, "open_pdf_location", {
    link: "papers/a.pdf#page=2",
  });
  assert.equal(failed.isError, true);
  assert.match(failed.text, /Could not open papers\/a\.pdf/u);
});

test("a path in two workspace folders is ambiguous, not opened from either", async () => {
  recordOpen(true);
  const second = await installWorkspace();
  try {
    vscode.workspace.workspaceFolders = [
      { uri: vscode.Uri.file(workspace.root) },
      { uri: vscode.Uri.file(second.root) },
    ];
    const answer = await callTool(fakeDeps(), "open_pdf_location", {
      link: "papers/a.pdf#page=1",
    });
    assert.equal(answer.isError, true);
    assert.match(answer.text, /more than one workspace folder/u);
    assert.deepEqual(opened, []);
  } finally {
    await second.remove();
  }
});

test("get_pdf_info reports the open viewer's pages, position, bookmarks and hash", async () => {
  const panel = fakePanel("papers/a.pdf", {
    outline: [
      {
        title: "Intro",
        page: 1,
        children: [{ title: "Setup", page: 2, children: [] }],
      },
      { title: "Part", children: [] },
    ],
  });
  const deps = fakeDeps({ panels: fakePanels([panel], panel) });
  for (const args of [{ path: "papers/a.pdf" }, {}]) {
    const answer = await callTool(deps, "get_pdf_info", args);
    assert.deepEqual(answer.json(), {
      file: "papers/a.pdf",
      open: true,
      protectedFolder: false,
      pageCount: 12,
      page: 3,
      zoomPercent: 110,
      sha256: "ab".repeat(32),
      outline: [
        { title: "Intro", page: 1, depth: 0 },
        { title: "Setup", page: 2, depth: 1 },
        { title: "Part", depth: 0 },
      ],
    });
  }
});

test("get_pdf_info finds the editor of a PDF that is not the last viewed, and flags a protected folder", async () => {
  const other = fakePanel("papers/b.pdf");
  const raw = fakePanel(".raw/c.pdf");
  const deps = fakeDeps({ panels: fakePanels([raw, other], other) });
  const answer = await callTool(deps, "get_pdf_info", { path: ".raw/c.pdf" });
  assert.deepEqual(answer.json(), {
    file: ".raw/c.pdf",
    open: true,
    protectedFolder: true,
    pageCount: 12,
    page: 3,
    zoomPercent: 110,
    sha256: "ab".repeat(32),
  });
});

test("get_pdf_info says when a PDF is not open, or the viewer is still loading it", async () => {
  const closed = await callTool(fakeDeps(), "get_pdf_info", {
    path: "papers/a.pdf",
  });
  assert.deepEqual(closed.json(), {
    file: "papers/a.pdf",
    open: false,
    protectedFolder: false,
    note: "Not open in Lumiere: page count, position, bookmarks and hash are known only for an open PDF (open_pdf_location opens it).",
  });
  const loading = fakePanel("papers/a.pdf", {
    view: undefined,
    sha256: undefined,
  });
  const answer = await callTool(
    fakeDeps({ panels: fakePanels([loading], loading) }),
    "get_pdf_info",
  );
  assert.deepEqual(answer.json(), {
    file: "papers/a.pdf",
    open: true,
    protectedFolder: false,
    note: "The viewer is still loading the PDF.",
  });
});

test("get_pdf_info and find_notes_citing_pdf say when no PDF has been viewed, and refuse a PDF outside the workspace", async () => {
  for (const name of ["get_pdf_info", "find_notes_citing_pdf"]) {
    const none = await callTool(fakeDeps(), name);
    assert.equal(none.isError, true, name);
    assert.match(none.text, /No PDF has been viewed in Lumiere/u);
    const outside = await callTool(fakeDeps(), name, {
      path: workspace.outside,
    });
    assert.equal(outside.isError, true, name);
    assert.match(outside.text, OUTSIDE_MESSAGE);
    const escape = await callTool(fakeDeps(), name, {
      path: "papers/escape.pdf",
    });
    assert.equal(escape.isError, true, name);
  }
});

/** The window opened the workspace through a link (`~/vault`); the agent names the real path. */
function realPathForms(relative: string): string[] {
  const real = workspace.uri(relative);
  return [
    `${real.fsPath}#page=3`, // an absolute path
    `${real.toString()}#page=3`, // a file: URI
  ];
}

test("a real path under a workspace folder that was opened through a link names the PDF of that window", async () => {
  workspace.openThroughLink();
  recordOpen(true);
  // The editor has the PDF open by the folder's own path, as the window opened it.
  const panel = fakePanel("papers/a.pdf", {
    uri: workspace.linkUri("papers/a.pdf"),
  });
  const deps = fakeDeps({ panels: fakePanels([panel], panel) });
  for (const form of realPathForms("papers/a.pdf")) {
    const info = await callTool(deps, "get_pdf_info", { path: form });
    assert.equal(info.isError, false, form);
    assert.deepEqual(info.json(), {
      file: "papers/a.pdf",
      open: true,
      protectedFolder: false,
      pageCount: 12,
      page: 3,
      zoomPercent: 110,
      sha256: "ab".repeat(32),
    });
    const opening = await callTool(deps, "open_pdf_location", { link: form });
    assert.equal(opening.text, "Opened papers/a.pdf at page 3.", form);
  }
  // Opened in the window's form of the path, so the command finds the open editor.
  assert.deepEqual(
    opened.map(([, target]) => String(target)),
    [
      workspace.linkUri("papers/a.pdf").with({ fragment: "page=3" }).toString(),
      workspace.linkUri("papers/a.pdf").with({ fragment: "page=3" }).toString(),
    ],
  );
});

test("a real path under a linked workspace folder is in its protected folder, and its notes are found", async () => {
  workspace.openThroughLink();
  const raw = fakePanel(".raw/c.pdf", { uri: workspace.linkUri(".raw/c.pdf") });
  const deps = fakeDeps({
    panels: fakePanels([raw], raw),
    backlinks: indexNotes({ "notes/a.md": "[p](.raw/c.pdf#page=4)" }, true),
  });
  const real = workspace.uri(".raw/c.pdf").fsPath;
  const info = await callTool(deps, "get_pdf_info", { path: real });
  assert.deepEqual(
    (info.json() as { protectedFolder: boolean }).protectedFolder,
    true,
  );
  const found = await callTool(deps, "find_notes_citing_pdf", { path: real });
  assert.deepEqual(found.json(), {
    file: ".raw/c.pdf",
    count: 1,
    links: [{ note: "notes/a.md", page: 4 }],
  });
});

test("the outline is cut at its cap with a flag, titles are clipped and depth counts", () => {
  const long = "T".repeat(500);
  const chain = (depth: number): never =>
    ({
      title: `h${depth}`,
      page: depth,
      children: depth < 3 ? [chain(depth + 1)] : [],
    }) as never;
  const flat = Array.from({ length: 300 }, (_, i) => ({
    title: i === 0 ? long : `t${i}`,
    page: i + 1,
    children: [],
  }));
  const cut = flattenOutline(flat);
  assert.equal(cut.outline.length, 200);
  assert.equal(cut.outlineTruncated, true);
  assert.equal(cut.outline[0]!.title.length, 200);
  assert.ok(cut.outline[0]!.title.endsWith("…"));
  assert.deepEqual(
    flattenOutline([chain(0)]).outline.map((entry) => entry.depth),
    [0, 1, 2, 3],
  );
  assert.equal("outlineTruncated" in flattenOutline([chain(0)]), false);
});

/** A note's link to a.pdf, as the backlink index reads it. */
function indexNotes(
  notes: Record<string, string>,
  throughLink = false,
): PdfBacklinkIndex {
  const index = new PdfBacklinkIndex();
  // The notes are indexed under the workspace folder as the window has it.
  const folder = vscode.Uri.file(
    throughLink ? workspace.link : workspace.root,
  ).toString();
  for (const [file, text] of Object.entries(notes)) {
    const noteUri = vscode.Uri.file(path.join(workspace.root, file)).toString();
    index.replaceNote(noteUri, file, text, folder);
  }
  return index;
}

test("find_notes_citing_pdf lists the notes linking to the PDF with page, quote and region", async () => {
  const backlinks = indexNotes({
    "notes/b.md":
      "see [p. 7](../papers/a.pdf#page=7) and [x](papers/a.pdf#page=2&viewrect=10,20,30,40)",
    "notes/a.md": "[q](papers/a.pdf#page=3#:~:text=Scaled%20dot-product)",
    "notes/other.md": "[o](papers/b.pdf#page=1)",
    "notes/none.md": "no links",
  });
  const answer = await callTool(
    fakeDeps({ backlinks }),
    "find_notes_citing_pdf",
    { path: "papers/a.pdf" },
  );
  assert.deepEqual(answer.json(), {
    file: "papers/a.pdf",
    count: 3,
    links: [
      { note: "notes/a.md", page: 3, quote: "Scaled dot-product" },
      {
        note: "notes/b.md",
        page: 2,
        region: { left: 10, top: 20, width: 30, height: 40 },
      },
      { note: "notes/b.md", page: 7 },
    ],
  });
});

test("find_notes_citing_pdf answers for the last viewed PDF, and caps a long list", async () => {
  const notes: Record<string, string> = {};
  for (let i = 0; i < 150; i++) {
    notes[`notes/n${String(i).padStart(3, "0")}.md`] =
      "[p](papers/a.pdf#page=1)";
  }
  const panel = fakePanel("papers/a.pdf");
  const deps = fakeDeps({
    panels: fakePanels([panel], panel),
    backlinks: indexNotes(notes),
  });
  const answer = (await callTool(deps, "find_notes_citing_pdf")).json() as {
    count: number;
    links: { note: string }[];
    truncated?: boolean;
  };
  assert.equal(answer.count, 150);
  assert.equal(answer.links.length, 100);
  assert.equal(answer.truncated, true);
  assert.equal(answer.links[0]!.note, "notes/n000.md");
  const none = await callTool(
    fakeDeps({ panels: fakePanels([panel], panel) }),
    "find_notes_citing_pdf",
  );
  assert.deepEqual(none.json(), { file: "papers/a.pdf", count: 0, links: [] });
});

test("the new tools are read-only, and open_pdf_location is not", async () => {
  const tools = await withClient(
    fakeDeps(),
    async (client) => (await client.listTools()).tools,
  );
  const readOnly = new Map(
    tools.map((tool) => [tool.name, tool.annotations?.readOnlyHint === true]),
  );
  assert.deepEqual(Object.fromEntries(readOnly), {
    get_current_pdf_selection: true,
    open_pdf_location: false,
    get_current_note_selection: true,
    get_pdf_info: true,
    find_notes_citing_pdf: true,
    get_ide_context: true,
  });
});
