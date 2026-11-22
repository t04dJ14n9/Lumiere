/**
 * The IDE context an agent asks for with `get_ide_context` and the
 * `lumiere://ide-context` resource: where the user is in Lumiere's notes and
 * PDFs, which a text-editor integration (Claude Code's) cannot see because
 * they are custom editors.
 *
 * The facts come from the IDE context packet (`@workshop/agents/ide-context`:
 * gather, scrub, then truncate to its caps), as Copy IDE Context builds it,
 * so an agent is never handed more than the packet allows. What Lumiere's
 * public API does not report is left out rather than guessed: a note's
 * caret when nothing is selected, and its visible lines.
 */
import * as vscode from "vscode";
import {
  DEFAULT_CAPS,
  createVsCodeIdeContextHost,
  gatherIdeContext,
  scrubPacket,
  truncatePacket,
  type IdeContextHostApis,
  type IdeContextPacket,
} from "@workshop/agents/ide-context";
import { boundingRect, toViewRect } from "../../../../shared/geometry";
import { formatPdfDeepLink } from "../../../../shared/text-fragment";
import {
  buildPdfIdeContextPacket,
  viewedPages,
} from "../../ideContext/adapter";
import { displayPath } from "../../pdf/files";
import type { PdfPanel } from "../../pdf/panel";
import type { ActiveNote } from "../note-selections";
import type { BridgeDeps } from "./deps";
import { listLumiereTabs, type LumiereTab } from "./ide-context-tabs";

/** How much of a selected passage goes into a locator: its start finds it. */
const LOCATOR_QUOTE_CHARS = 120;

export interface IdeContext {
  version: 1;
  collectedAt: string;
  workspace?: { name?: string; folderCount: number };
  /** The kind of Lumiere editor in front, when one is. */
  focus?: "note" | "pdf";
  /** The active note, else the first open one. */
  note?: NoteContext;
  /** The PDF the user viewed last. */
  pdf?: PdfContext;
  tabs: LumiereTab[];
  warnings: string[];
}

export interface NoteContext {
  path: string;
  dirty: boolean;
  selection?: {
    startLine: number;
    endLine: number;
    text: string;
    truncated: boolean;
  };
  /** The headings that enclose the selection's first line, outermost first. */
  headingPath: string[];
  /** 1-based; known only when the note is open in a text editor too. */
  caret?: { line: number; column: number };
}

export interface PdfContext {
  path: string;
  page?: number;
  pageCount?: number;
  zoomPercent?: number;
  sha256?: string;
  /** `path#page=N`, with `#:~:text=…` for a selected passage or `&viewrect=…` for a region. */
  locator?: string;
  selection:
    | { kind: "none" }
    | { kind: "text"; text: string; truncated: boolean; pages: number[] }
    | {
        kind: "region";
        page: number;
        viewrect: { left: number; top: number; width: number; height: number };
      };
}

export async function collectIdeContext(deps: BridgeDeps): Promise<IdeContext> {
  const host = createVsCodeIdeContextHost(vscode);
  const warnings: string[] = [];
  const note = await noteContext(deps, host, warnings);
  const pdf = pdfContext(deps.lastPdf.panel, host, warnings);
  const { tabs, focus, outside, cut } = listLumiereTabs(
    DEFAULT_CAPS.maxTabUris,
  );
  if (outside > 0) {
    warnings.push(
      `${outside} open tab(s) outside the workspace are not listed`,
    );
  }
  if (cut > 0) {
    warnings.push(`${cut} more open tab(s) are not listed`);
  }
  if (!note && !pdf) {
    warnings.push("No Lumiere note or PDF is open.");
  }
  return {
    version: 1,
    collectedAt: new Date().toISOString(),
    ...(host.workspace ? { workspace: host.workspace } : {}),
    ...(focus ? { focus } : {}),
    ...(note ? { note } : {}),
    ...(pdf ? { pdf } : {}),
    tabs,
    warnings,
  };
}

/** The packet after the pipeline every consumer runs: scrub, then truncate. */
function prepared(packet: IdeContextPacket): IdeContextPacket {
  return truncatePacket(scrubPacket(packet), packet.caps);
}

async function noteContext(
  deps: BridgeDeps,
  host: IdeContextHostApis,
  warnings: string[],
): Promise<NoteContext | undefined> {
  const note = await deps.notes?.active();
  if (!note) {
    return undefined;
  }
  const packet = prepared(notePacket(note, host));
  warnings.push(...packet.warnings);
  const { selection, caret } = packet.active ?? {};
  return {
    path: displayPath(note.uri),
    dirty: note.isDirty,
    ...(selection
      ? {
          selection: {
            startLine: selection.startLine,
            endLine: selection.endLine,
            text: selection.text,
            truncated: selection.truncated,
          },
        }
      : {}),
    headingPath: [...note.headingPath],
    ...(caret
      ? { caret: { line: caret.line + 1, column: caret.character + 1 } }
      : {}),
  };
}

function notePacket(
  note: ActiveNote,
  host: IdeContextHostApis,
): IdeContextPacket {
  const { selection } = note;
  return gatherIdeContext(host, {
    product: "markdownWorkshop",
    uri: note.uri.toString(),
    markdown: { editorKind: "livePreview" },
    ...(selection ? { selection: { ...selection, truncated: false } } : {}),
  });
}

function pdfContext(
  panel: PdfPanel | undefined,
  host: IdeContextHostApis,
  warnings: string[],
): PdfContext | undefined {
  if (!panel) {
    return undefined;
  }
  const selected = panel.selectionSnapshot();
  const sha256 = panel.sha256 ?? selected?.sha256;
  const packet = prepared(
    buildPdfIdeContextPacket({
      uri: panel.uri.toString(),
      selection: selected?.selection,
      ...viewedPages(panel.view),
      ...(sha256 ? { sourceSha256: sha256 } : {}),
      host,
    }),
  );
  warnings.push(...packet.warnings);
  const path = displayPath(panel.uri);
  const { page } = packet.pdf ?? {};
  const selection = packet.pdf ? pdfSelection(packet.pdf.selection) : NONE;
  return {
    path,
    ...(page === undefined ? {} : { page }),
    ...(packet.pdf?.pageCount === undefined
      ? {}
      : { pageCount: packet.pdf.pageCount }),
    ...(panel.view ? { zoomPercent: panel.view.zoomPercent } : {}),
    ...(sha256 ? { sha256 } : {}),
    ...locatorOf(path, page, selection),
    selection,
  };
}

const NONE = { kind: "none" } as const;

type Wire = NonNullable<IdeContextPacket["pdf"]>["selection"];

/** The packet's selection (already capped), as pages and a view rectangle. */
function pdfSelection(wire: Wire): PdfContext["selection"] {
  if (wire.kind === "text") {
    const pages = [...new Set((wire.rects ?? []).map((rect) => rect.page))];
    return {
      kind: "text",
      text: wire.text,
      truncated: wire.truncated,
      pages: pages.sort((a, b) => a - b),
    };
  }
  const rect = wire.kind === "region" ? wire.rects[0] : undefined;
  if (!rect) {
    return NONE;
  }
  return {
    kind: "region",
    page: rect.page,
    viewrect: toViewRect(
      boundingRect([[rect.x, rect.y, rect.x + rect.w, rect.y + rect.h]]),
    ),
  };
}

/** The link to what the reader sees: the selection if there is one, else the page. */
function locatorOf(
  path: string,
  page: number | undefined,
  selection: PdfContext["selection"],
): { locator?: string } {
  if (selection.kind === "region") {
    return {
      locator: formatPdfDeepLink(path, {
        page: selection.page,
        viewRect: selection.viewrect,
      }),
    };
  }
  const at = selection.kind === "text" ? (selection.pages[0] ?? page) : page;
  if (at === undefined) {
    return {};
  }
  const text =
    selection.kind === "text"
      ? selection.text.slice(0, LOCATOR_QUOTE_CHARS)
      : undefined;
  return {
    locator: formatPdfDeepLink(path, { page: at, ...(text ? { text } : {}) }),
  };
}
