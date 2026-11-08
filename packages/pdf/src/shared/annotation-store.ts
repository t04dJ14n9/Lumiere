/**
 * Lumia's own annotations on a PDF, kept outside the PDF so its bytes (and
 * so its SHA-256, which vaults record for immutable sources) never change.
 * One JSON file per PDF content hash: the same PDF in `inbox/` and in
 * `.raw/` shows the same annotations, and a moved or renamed copy keeps them.
 *
 * The file holds EmbedPDF's portable annotation items (`exportAnnotations`
 * gives them, `importAnnotations` takes them). JSON has no dates or bytes,
 * so `created`/`modified` dates and a stamp's image bytes are tagged.
 */

export const ANNOTATION_STORE_VERSION = 1;

/** The default folder of the annotation files, relative to the PDF's workspace folder. */
export const ANNOTATION_STORE_FOLDER = ".lumiere/pdf-annotations";

/**
 * Where `lumiere.pdf.annotations.folder` puts the annotation files: under
 * the PDF's workspace folder (a relative path), under the home folder
 * (`~/…`), or at an absolute path. Empty or not a string: the default.
 */
export type AnnotationFolder =
  | { from: "workspace" | "home"; segments: string[] }
  | { from: "absolute"; path: string };

export function annotationFolder(setting: unknown): AnnotationFolder {
  const text = typeof setting === "string" ? setting.trim() : "";
  if (text === "") {
    return { from: "workspace", segments: segments(ANNOTATION_STORE_FOLDER) };
  }
  if (text === "~" || /^~[\\/]/u.test(text)) {
    return { from: "home", segments: segments(text.slice(1)) };
  }
  if (/^(?:[\\/]|[A-Za-z]:[\\/])/u.test(text)) {
    return { from: "absolute", path: text };
  }
  return { from: "workspace", segments: segments(text) };
}

/** An annotation as EmbedPDF transfers it; the viewer gives it its own type. */
export interface StoredAnnotation {
  annotation: { id: string; pageIndex: number; type: number } & Record<
    string,
    unknown
  >;
  ctx?: unknown;
}

const SHA256 = /^[0-9a-f]{64}$/u;

/** The annotation file's name for a PDF with this content hash. */
export function annotationStoreName(sha256: string): string {
  if (!SHA256.test(sha256)) {
    throw new Error(`Not a SHA-256: ${sha256}`);
  }
  return `${sha256}.json`;
}

/** The file's text, or undefined when there is nothing to keep (no file). */
export function serializeAnnotations(
  items: readonly StoredAnnotation[],
): string | undefined {
  if (items.length === 0) {
    return undefined;
  }
  const sorted = [...items].sort(
    (a, b) =>
      a.annotation.pageIndex - b.annotation.pageIndex ||
      a.annotation.id.localeCompare(b.annotation.id),
  );
  return `${JSON.stringify(
    encode({ version: ANNOTATION_STORE_VERSION, annotations: sorted }),
    null,
    2,
  )}\n`;
}

/** The value with dates and bytes tagged, as plain JSON data. */
function encode(value: unknown): unknown {
  if (value instanceof Date) {
    return { $date: value.toISOString() };
  }
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return { $bytes: toBase64(bytesOf(value)) };
  }
  if (Array.isArray(value)) {
    return value.map(encode);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, encode(entry)]),
    );
  }
  return value;
}

/** The annotations in a file's text; undefined when it is not one. */
export function parseAnnotations(text: string): StoredAnnotation[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text, (_key, value: unknown) => revive(value));
  } catch {
    return undefined;
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { version?: unknown }).version !== ANNOTATION_STORE_VERSION ||
    !Array.isArray((parsed as { annotations?: unknown }).annotations)
  ) {
    return undefined;
  }
  const items = (parsed as { annotations: unknown[] }).annotations;
  return items.every(isStoredAnnotation) ? items : undefined;
}

/**
 * Whether a workspace-relative path is inside one of `folders` (also
 * workspace-relative), where a vault keeps sources that must not change.
 */
export function inProtectedFolder(
  path: string,
  folders: readonly string[],
): boolean {
  const parts = segments(path);
  return folders.some((folder) => {
    const prefix = segments(folder);
    return (
      prefix.length > 0 &&
      prefix.length < parts.length &&
      prefix.every((part, index) => part === parts[index])
    );
  });
}

function segments(path: string): string[] {
  return path
    .replaceAll("\\", "/")
    .split("/")
    .filter((part) => part !== "" && part !== ".");
}

function revive(value: unknown): unknown {
  if (typeof value !== "object" || value === null) {
    return value;
  }
  const tagged = value as { $date?: unknown; $bytes?: unknown };
  const keys = Object.keys(value);
  if (keys.length === 1 && typeof tagged.$date === "string") {
    const date = new Date(tagged.$date);
    return Number.isNaN(date.getTime()) ? value : date;
  }
  if (keys.length === 1 && typeof tagged.$bytes === "string") {
    return fromBase64(tagged.$bytes).buffer;
  }
  return value;
}

function isStoredAnnotation(item: unknown): item is StoredAnnotation {
  const annotation = (item as { annotation?: unknown } | null)?.annotation as
    { id?: unknown; pageIndex?: unknown; type?: unknown } | undefined;
  return (
    typeof annotation === "object" &&
    annotation !== null &&
    typeof annotation.id === "string" &&
    Number.isInteger(annotation.pageIndex) &&
    (annotation.pageIndex as number) >= 0 &&
    typeof annotation.type === "number"
  );
}

function bytesOf(value: ArrayBuffer | ArrayBufferView): Uint8Array {
  return value instanceof ArrayBuffer
    ? new Uint8Array(value)
    : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
