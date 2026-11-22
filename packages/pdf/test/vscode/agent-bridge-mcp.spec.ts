import {
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { Frame, Page } from "@playwright/test";
import { bridgeRequest, StdioShim } from "./mcp-client";
import { paths } from "./state";
import {
  command,
  expect,
  fitPage,
  openFile,
  pagePoint,
  pdfViewer,
  selectText,
  showPage,
  test,
} from "./workbench";

// An agent's view of a real window: the bridge on, a note and a PDF open, and
// an MCP client talking to it through the stdio shim Claude Code, Codex and
// Cursor run. The tools' arguments and answers are covered by
// test/unit/agent-bridge-*.test.ts; this checks them in the real editor.

const NOTE = "agent-bridge-note.md";
const PDF = "docs/outline.pdf";
const SHIM = path.join(paths.extension, "dist", "pdf", "bridge-stdio.js");
const SETTINGS = path.join(paths.userData, "User", "settings.json");
/** Where a running bridge announces itself; this profile's own home folder. */
const BRIDGES = path.join(paths.home, ".agent-pdf-viewer", "bridges");
/** A PDF next to the workspace folder, not in it. */
const OUTSIDE = path.join(paths.root, "outside-workspace.pdf");
const ESCAPE_LINK = path.join(paths.workspace, "docs", "escape-link.pdf");
const TEXT_MIDLINE = 94;

const NOTE_TEXT = [
  "# Bridge note",
  "",
  "First line of the note.",
  "Second line cites the paper: [p. 3](docs/outline.pdf#page=3)",
  "Third line is here.",
  "",
  "## Details",
  "",
  "Fourth line.",
  "",
].join("\n");

const TOOLS = [
  "find_notes_citing_pdf",
  "get_current_note_selection",
  "get_current_pdf_selection",
  "get_ide_context",
  "get_pdf_info",
  "open_pdf_location",
];

interface IdeContext {
  focus: string;
  note?: {
    path: string;
    selection?: { startLine: number; endLine: number; text: string };
    headingPath: string[];
  };
  pdf?: {
    path: string;
    page: number;
    pageCount: number;
    sha256: string;
    selection?: { text: string };
  };
  tabs: { kind: string; path: string; visible: boolean; active: boolean }[];
}

function bridgeRecords(): string[] {
  return existsSync(BRIDGES)
    ? readdirSync(BRIDGES).filter((name) => name.endsWith(".json"))
    : [];
}

/** The note editor's frame in VS Code's nested webview frames. */
async function noteFrame(page: Page): Promise<Frame> {
  let found: Frame | undefined;
  await expect
    .poll(async () => {
      for (const frame of page.frames()) {
        try {
          if (
            await frame
              .getByRole("textbox", { name: "Markdown content" })
              .count()
          ) {
            found = frame;
            return true;
          }
        } catch {
          // The frame went away while a tab was changing.
        }
      }
      return false;
    })
    .toBe(true);
  return found!;
}

/** Click into the note and select its first three lines. */
async function selectNoteLines(page: Page): Promise<void> {
  const frame = await noteFrame(page);
  await frame.locator(".cm-line", { hasText: "First line" }).click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+End");
}

/**
 * Whether a webview holds the keyboard: its iframe is the active element of
 * the workbench and its page has focus.
 */
async function hasKeyboard(page: Page, frame: Frame): Promise<boolean> {
  let outermost = frame;
  while (
    outermost.parentFrame() &&
    outermost.parentFrame() !== page.mainFrame()
  ) {
    outermost = outermost.parentFrame()!;
  }
  const webview = await outermost.frameElement();
  const iframeIsActive = await webview.evaluate(
    (element) => document.activeElement === element,
  );
  return iframeIsActive && (await frame.evaluate(() => document.hasFocus()));
}

/** The index of the editor group the keyboard is in. */
function focusedGroup(page: Page): Promise<number> {
  return page.evaluate(() =>
    [...document.querySelectorAll(".editor-group-container")].findIndex(
      (group) => group.classList.contains("active"),
    ),
  );
}

/** Whether any PDF viewer, in any tab, holds the keyboard. */
async function viewerHasKeyboard(page: Page): Promise<boolean> {
  for (const frame of page.frames()) {
    try {
      if (
        (await frame.locator(".viewer .page").count()) &&
        (await hasKeyboard(page, frame))
      ) {
        return true;
      }
    } catch {
      // The frame went away while a tab was changing.
    }
  }
  return false;
}

/** Whether any open viewer flashes a location box on the page (1-based). */
async function hasLocationHighlight(
  page: Page,
  pageNumber: number,
): Promise<boolean> {
  for (const frame of page.frames()) {
    try {
      const boxes = frame.locator(
        `.page[data-page-index="${pageNumber - 1}"] .location-highlight`,
      );
      if (await boxes.count()) {
        return true;
      }
    } catch {
      // The frame went away while a tab was changing.
    }
  }
  return false;
}

/** The refusal with the argument taken out: it must not depend on the file. */
function refusal(text: string, argument: string): string {
  return text.split(argument).join("<argument>");
}

test("an MCP client reaches this window through the stdio shim, and the bridge refuses what is not the workspace's", async ({
  workbench: page,
}) => {
  test.setTimeout(120_000);
  const originalSettings = readFileSync(SETTINGS, "utf8");
  const clients: StdioShim[] = [];
  try {
    copyFileSync(path.join(paths.fixtures, "outline.pdf"), OUTSIDE);
    rmSync(ESCAPE_LINK, { force: true });
    symlinkSync(OUTSIDE, ESCAPE_LINK);
    writeFileSync(path.join(paths.workspace, NOTE), NOTE_TEXT);

    const endpoint =
      await test.step("turn the bridge on and open a PDF", async () => {
        await openFile(page, PDF);
        await pdfViewer(page);
        writeFileSync(
          SETTINGS,
          JSON.stringify(
            {
              ...(JSON.parse(originalSettings) as Record<string, unknown>),
              "lumiere.pdf.agentBridge.enabled": true,
            },
            null,
            2,
          ),
        );
        await expect.poll(bridgeRecords, { timeout: 30_000 }).toHaveLength(1);
        const [name] = bridgeRecords();
        const record = JSON.parse(
          readFileSync(path.join(BRIDGES, name!), "utf8"),
        ) as { url: string; token: string; workspaceFolders: string[] };
        expect(record.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/u);
        expect(record.workspaceFolders).toEqual([paths.workspace]);
        return record;
      });

    await test.step("a note in Lumiere with three lines selected, a PDF with text selected beside it", async () => {
      await openFile(page, NOTE);
      await command(page, "View: Reopen Editor With...");
      await page
        .locator(".quick-input-widget .monaco-list-row")
        .filter({ hasText: "Lumiere" })
        .first()
        .click();
      await noteFrame(page);

      await openFile(page, PDF);
      const viewer = await pdfViewer(page);
      await fitPage(page, viewer);
      await showPage(page, viewer, 3);
      const at = await pagePoint(viewer, 3);
      await selectText(
        page,
        viewer,
        at(74, TEXT_MIDLINE),
        at(205, TEXT_MIDLINE),
      );
      // The PDF goes to the group on the right; the note keeps the keyboard.
      await command(page, "View: Move Editor into Right Group");
      await page
        .locator(".editor-group-container .tab", { hasText: NOTE })
        .first()
        .click();
      await selectNoteLines(page);
    });

    const shim = new StdioShim(SHIM, {
      cwd: paths.workspace,
      env: { HOME: paths.home, AGENT_PDF_BRIDGE_DIR: BRIDGES },
    });
    clients.push(shim);

    await test.step("initialize, tools/list and resources/list", async () => {
      const init = await shim.result<{ serverInfo: { name: string } }>(
        "initialize",
        {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "lumiere-e2e", version: "0" },
        },
      );
      expect(init.serverInfo.name).toBe("agent-pdf-viewer");
      shim.notify("notifications/initialized");

      const { tools } = await shim.result<{
        tools: { name: string; annotations?: { readOnlyHint?: boolean } }[];
      }>("tools/list");
      expect(tools.map((tool) => tool.name).sort()).toEqual(TOOLS);
      expect(
        tools
          .filter((tool) => tool.annotations?.readOnlyHint !== true)
          .map((tool) => tool.name),
      ).toEqual(["open_pdf_location"]);

      const { resources } = await shim.result<{ resources: { uri: string }[] }>(
        "resources/list",
      );
      expect(resources.map((resource) => resource.uri)).toEqual([
        "lumiere://ide-context",
      ]);
    });

    await test.step("the note's and the PDF's selections arrive", async () => {
      await expect
        .poll(
          async () =>
            (await shim.callTool("get_current_note_selection", {})).text,
        )
        .toContain("> Third line is here.");
      await expect
        .poll(
          async () =>
            (await shim.callTool("get_current_pdf_selection", {})).text,
        )
        .toContain("Synthetic page 3");
    });

    await test.step("get_ide_context and lumiere://ide-context say where the user is", async () => {
      const tool = await shim.callTool("get_ide_context", {});
      expect(tool.isError).toBe(false);
      const context = JSON.parse(tool.text) as IdeContext;
      expect(context.focus).toBe("note");
      expect(context.note?.path).toBe(NOTE);
      expect(context.note?.headingPath).toEqual(["Bridge note"]);
      expect(context.note?.selection).toMatchObject({
        startLine: 3,
        endLine: 5,
      });
      expect(context.note?.selection?.text).toContain(
        "First line of the note.",
      );
      expect(context.pdf).toMatchObject({
        path: PDF,
        page: 3,
        pageCount: 12,
      });
      expect(context.pdf?.sha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(context.pdf?.selection?.text).toContain("Synthetic page 3");
      expect(
        context.tabs.map(({ kind, path: tab, visible }) => ({
          kind,
          path: tab,
          visible,
        })),
      ).toEqual(
        expect.arrayContaining([
          { kind: "note", path: NOTE, visible: true },
          { kind: "pdf", path: PDF, visible: true },
        ]),
      );

      const { contents } = await shim.result<{
        contents: { uri: string; text: string }[];
      }>("resources/read", { uri: "lumiere://ide-context" });
      const resource = JSON.parse(contents[0]!.text) as IdeContext;
      expect(resource.note?.path).toBe(NOTE);
      expect(resource.pdf?.path).toBe(PDF);
    });

    await test.step("get_pdf_info, with and without a path", async () => {
      for (const args of [{}, { path: PDF }]) {
        const info = await shim.callTool("get_pdf_info", args);
        expect(info.isError).toBe(false);
        expect(JSON.parse(info.text)).toMatchObject({
          file: PDF,
          open: true,
          pageCount: 12,
          page: 3,
          outline: expect.arrayContaining([
            { title: "Part One", page: 1, depth: 0 },
          ]),
        });
      }
    });

    await test.step("find_notes_citing_pdf finds the note once it is indexed", async () => {
      await expect
        .poll(async () => {
          const found = await shim.callTool("find_notes_citing_pdf", {});
          return found.isError ? undefined : JSON.parse(found.text);
        })
        .toMatchObject({
          file: PDF,
          count: 1,
          links: [{ note: NOTE, page: 3 }],
        });
    });

    await test.step("open_pdf_location opens the page without taking the keyboard", async () => {
      // The user is typing in the note, in the left group.
      expect(await hasKeyboard(page, await noteFrame(page))).toBe(true);
      const groupBefore = await focusedGroup(page);
      const opened = await shim.callTool("open_pdf_location", {
        link: `${PDF}#page=5&viewrect=72,83,134,21`,
      });
      expect(opened).toEqual({
        isError: false,
        text: `Opened ${PDF} at page 5.`,
      });
      await expect.poll(() => hasLocationHighlight(page, 5)).toBe(true);
      // The viewer opened the page and did not take the keyboard from the
      // group the user is in. (The note may now be hidden behind the PDF tab
      // that opened in its group, and still hold the keyboard.)
      expect(await viewerHasKeyboard(page)).toBe(false);
      expect(await focusedGroup(page)).toBe(groupBefore);
      const info = await shim.callTool("get_pdf_info", {});
      expect(JSON.parse(info.text)).toMatchObject({ page: 5 });
    });

    await test.step("a PDF outside the workspace, a .. escape and a link out are refused alike, and no differently from a missing file", async () => {
      const missing = "docs/does-not-exist.pdf";
      const escapes = [
        OUTSIDE,
        path.relative(paths.workspace, OUTSIDE),
        `file://${OUTSIDE}`,
        "docs/escape-link.pdf",
      ];
      expect(escapes[1]).toMatch(/^\.\.\//u);
      for (const [tool, key] of [
        ["open_pdf_location", "link"],
        ["get_pdf_info", "path"],
        ["find_notes_citing_pdf", "path"],
      ] as const) {
        const gone = await shim.callTool(tool, { [key]: missing });
        expect(gone.isError).toBe(true);
        expect(gone.text).toContain("inside this window's workspace folders");
        for (const argument of escapes) {
          const refused = await shim.callTool(tool, { [key]: argument });
          expect(refused.isError, `${tool} ${argument}`).toBe(true);
          expect(refusal(refused.text, argument)).toBe(
            refusal(gone.text, missing),
          );
        }
      }
    });

    await test.step("a shim started outside every workspace refuses to choose a window", async () => {
      const stray = new StdioShim(SHIM, {
        cwd: paths.root,
        env: { HOME: paths.home, AGENT_PDF_BRIDGE_DIR: BRIDGES },
      });
      clients.push(stray);
      const response = await stray.request("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "lumiere-e2e", version: "0" },
      });
      expect(response.error?.message).toContain("has a workspace containing");
    });

    await test.step("the bridge takes its token from the Authorization header only", async () => {
      const headers = {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      };
      const body = { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} };
      const bearer = { ...headers, Authorization: `Bearer ${endpoint.token}` };
      const status = async (
        request: Parameters<typeof bridgeRequest>[1],
      ): Promise<number> =>
        (await bridgeRequest(endpoint.url, { body, ...request })).status;

      expect(await status({ path: `/mcp/${endpoint.token}`, headers })).toBe(
        401,
      );
      expect(
        await status({ path: `/mcp?token=${endpoint.token}`, headers }),
      ).toBe(401);
      expect(await status({ path: "/mcp", headers })).toBe(401);
      expect(
        await status({
          path: "/mcp",
          headers: { ...headers, Authorization: "Bearer not-the-token" },
        }),
      ).toBe(401);
      expect(
        await status({
          path: "/mcp",
          headers: { ...bearer, Origin: "https://evil.example" },
        }),
      ).toBe(403);
      expect(
        await status({
          path: "/.well-known/oauth-authorization-server",
          headers: {},
          method: "GET",
          body: undefined,
        }),
      ).toBe(404);

      const served = await bridgeRequest(endpoint.url, {
        path: "/mcp",
        headers: bearer,
        body,
      });
      expect(served.status).toBe(200);
      expect(served.body).toContain("get_ide_context");
    });
  } finally {
    await Promise.all(clients.map((client) => client.close()));
    writeFileSync(SETTINGS, originalSettings);
    rmSync(OUTSIDE, { force: true });
    rmSync(ESCAPE_LINK, { force: true });
    rmSync(path.join(paths.workspace, NOTE), { force: true });
  }
  // The bridge stops with its setting, and takes its discovery file with it.
  await expect.poll(bridgeRecords, { timeout: 20_000 }).toHaveLength(0);
});
