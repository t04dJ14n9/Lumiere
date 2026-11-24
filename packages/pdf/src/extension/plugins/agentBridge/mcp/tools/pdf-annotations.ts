/** `list_pdf_annotations`: Lumiere's marks on a PDF of the workspace, read from their file. */
import {
  annotationKey,
  pageRefsEqual,
  type Annotation,
  type AnnotationBundle,
} from "@embedpdf/engine-core/public";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type * as vscode from "vscode";
import {
  annotationRows,
  oneLine,
  QUOTE_EXCERPT,
  type AnnotationRow,
  type MarkInput,
} from "../../../../../shared/annotation-rows";
import { parseAnnotations } from "../../../../../shared/annotation-store";
import type { PageRect, ViewRect } from "../../../../../shared/geometry";
import { quoteBoxes } from "../../../../../shared/region-reader";
import { formatPdfDeepLink } from "../../../../../shared/text-fragment";
import { MAX_TEXT_PDF_BYTES } from "../../../../pdf-text/reader";
import { displayPath, vscodePdfFiles } from "../../../pdf/files";
import type { BridgeDeps } from "../deps";
import {
  flat,
  LINK_QUOTE_CHARS,
  pathArgument,
  refusal,
} from "./pdf-text-source";
import { guarded, jsonResult, ToolError } from "./results";
import { pdfSubject } from "./workspace-pdf";

/** Marks returned at most; a PDF covered in highlights is cut, with a flag. */
export const MAX_MARKS = 500;

/** A mark of the file, in what the tool needs to quote and link it. */
export interface Mark {
  row: AnnotationRow;
  /** The boxes of the text it marks, one a line; none for a mark that quotes nothing. */
  boxes: PageRect[];
  /** Where it is on its page. */
  rect: ViewRect;
}

export function registerListPdfAnnotations(
  server: McpServer,
  deps: BridgeDeps,
): void {
  server.registerTool(
    "list_pdf_annotations",
    {
      title: "Lumiere's marks on a PDF",
      description:
        "The highlights, underlines, notes and other marks Lumiere keeps for a PDF in the workspace, read from " +
        "their file (.lumiere/pdf-annotations/<sha256>.json by default) for the PDF's SHA-256, so the PDF need not " +
        "be open; the file is what the viewer last saved. Not the annotations written inside the PDF itself. " +
        "Returns { file, sha256, count, marks: [{ page, kind, color?, text?, note?, link }] } in reading order " +
        "(page, then top to bottom). `kind` is the mark's type (highlight, underline, strikeout, squiggly, text, " +
        "free-text, ink, …), `color` its #rrggbb, `text` the text a text mark covers (read from the PDF, at most " +
        `${QUOTE_EXCERPT} characters), \`note\` the start of its note (at most 80 characters), \`link\` opens ` +
        `the page at the text or box (usable with open_pdf_location). At most ${MAX_MARKS} marks, with ` +
        "`truncated` when there are more. A PDF with no marks gives an empty list. When the PDF's text cannot be " +
        "read (a password, copying forbidden, too large) the marks are listed without `text`, and `textNote` says why. " +
        "Omit `path` for the PDF the user viewed last.",
      inputSchema: { path: pathArgument },
      annotations: { readOnlyHint: true },
    },
    ({ path }) => guarded(() => listAnnotations(path, deps)),
  );
}

async function listAnnotations(path: string | undefined, deps: BridgeDeps) {
  const { uri, panel } = await pdfSubject(path, deps);
  const file = displayPath(uri);
  const sha256 = panel?.sha256 ?? (await hashOf(uri, file));
  const marks = await storedMarks(uri, sha256, file);
  const shown = marks.slice(0, MAX_MARKS);
  const quoted = await quotesOf(deps, uri, shown, file);
  return jsonResult({
    file,
    sha256,
    count: marks.length,
    marks: shown.map((mark, index) =>
      markEntry(mark, quoted.texts[index], file),
    ),
    ...(marks.length > MAX_MARKS ? { truncated: true } : {}),
    ...(quoted.note ? { textNote: quoted.note } : {}),
  });
}

/** The hash of a PDF that is not open (an open one reports its own). */
async function hashOf(uri: vscode.Uri, file: string): Promise<string> {
  const size = await vscodePdfFiles.size(uri.toString()).catch(() => -1);
  if (size < 0) {
    throw new ToolError(`${file} could not be read.`);
  }
  if (size > MAX_TEXT_PDF_BYTES) {
    throw new ToolError(
      `${file} is larger than ${MAX_TEXT_PDF_BYTES / 2 ** 20} MB and is not open, so its SHA-256 (which names its marks' file) is not known: ask the user to open it in Lumiere.`,
    );
  }
  return vscodePdfFiles.hash(uri.toString()).catch(() => {
    throw new ToolError(`${file} could not be read.`);
  });
}

/** The marks of the PDF's file; none when it has none. */
async function storedMarks(
  uri: vscode.Uri,
  sha256: string,
  file: string,
): Promise<Mark[]> {
  const text = await vscodePdfFiles.annotations.read(uri.toString(), sha256);
  if (text === undefined) {
    return [];
  }
  try {
    const stored = await parseAnnotations(text);
    if (stored) {
      return marksOf(stored.bundle);
    }
  } catch {
    // Damaged: said below, as for a file of another kind.
  }
  throw new ToolError(
    `The file of Lumiere's marks for ${file} could not be read (damaged, or written by a newer Lumiere).`,
  );
}

/**
 * The marks of the file's text, for the marks that quote text. One read of
 * the PDF, none when no mark needs it.
 */
async function quotesOf(
  deps: BridgeDeps,
  uri: vscode.Uri,
  marks: readonly Mark[],
  file: string,
): Promise<{ texts: (string | undefined)[]; note?: string }> {
  const wanted = marks.flatMap((mark, index) =>
    mark.boxes.length > 0
      ? [{ index, region: { page: mark.row.page, boxes: mark.boxes } }]
      : [],
  );
  if (wanted.length === 0) {
    return { texts: [] };
  }
  const reading = await deps.text.quotes(
    uri.toString(),
    wanted.map(({ region }) => region),
  );
  if (!reading.ok) {
    return {
      texts: [],
      note: `The marked text is not included: ${refusal(file, reading.reason).message}`,
    };
  }
  const texts: (string | undefined)[] = [];
  wanted.forEach(({ index }, at) => {
    texts[index] = reading.value[at];
  });
  return { texts };
}

/**
 * The marks of a bundle the reader would see (`isListedMark`), in reading
 * order. The file is named by the PDF's hash, so its pages are this PDF's
 * pages and a page's position in the file is its number here.
 */
export function marksOf(bundle: AnnotationBundle): Mark[] {
  const sources = new Map<string, Annotation>();
  const inputs: MarkInput[] = [];
  for (const { data } of bundle.items) {
    const position = bundle.pages.find(({ page }) =>
      pageRefsEqual(page, data.page),
    )?.position;
    if (position === undefined) {
      continue;
    }
    const key = annotationKey(data.ref);
    sources.set(key, data);
    inputs.push({
      key,
      subtype: data.subtype,
      page: position + 1,
      top: data.rect.y,
      left: data.rect.x,
      color: "color" in data ? data.color : undefined,
      contents: data.contents,
    });
  }
  return annotationRows(inputs).map((row) => {
    const source = sources.get(row.key)!;
    const { x, y, width, height } = source.rect;
    return {
      row,
      boxes: row.quotesText ? quoteBoxes(source) : [],
      rect: { left: x, top: y, width, height },
    };
  });
}

/**
 * A mark as the agent reads it. `text` is the marked text when it was read:
 * the link then quotes it, which finds the words even where the page was
 * laid out differently; otherwise the link names the mark's box.
 */
export function markEntry(
  { row, rect }: Mark,
  text: string | undefined,
  file: string,
) {
  const quote = oneLine(text, QUOTE_EXCERPT);
  const linkText = flat(text ?? "").slice(0, LINK_QUOTE_CHARS);
  return {
    page: row.page,
    kind: row.subtype,
    ...(row.color ? { color: row.color } : {}),
    ...(quote ? { text: quote } : {}),
    ...(row.note ? { note: row.note } : {}),
    link: formatPdfDeepLink(
      file,
      linkText
        ? { page: row.page, text: linkText }
        : { page: row.page, viewRect: rect },
    ),
  };
}
