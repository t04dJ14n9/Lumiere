/**
 * Lumia's own annotations on a PDF, kept outside the PDF so its bytes (and
 * so its SHA-256, which vaults record for immutable sources) never change.
 * One JSON file per PDF content hash: the same PDF in `inbox/` and in
 * `.raw/` shows the same annotations, and a moved or renamed copy keeps them.
 *
 * The file holds an EmbedPDF annotation bundle (`annotation.export()` gives
 * it, `annotation.import()` takes it), as `AnnotationTransfer` writes it:
 * one JSON document with each stamp's drawing in base64. Version 2 wraps it,
 * `{ version: 2, bundle }`, so the file says which generation of Lumia wrote
 * it and a later bundle format does not collide with version 1, which held
 * EmbedPDF 2's transfer items (`annotation-legacy`, still read).
 */
import { AnnotationTransfer } from "@embedpdf/engine-core/public";
import type {
  AnnotationBundle,
  AnnotationRef,
} from "@embedpdf/engine-core/public";
import { legacyToBundle, type LegacyAnnotation } from "./annotation-legacy";

export const ANNOTATION_STORE_VERSION = 2;

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
  bundle: AnnotationBundle,
): string | undefined {
  if (bundle.items.length === 0) {
    return undefined;
  }
  const file = {
    version: ANNOTATION_STORE_VERSION,
    bundle: JSON.parse(AnnotationTransfer.stringify(bundle)) as unknown,
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** What a file holds, and how the import maps its pages onto the PDF's. */
export interface StoredAnnotations {
  bundle: AnnotationBundle;
  /**
   * `same`: the bundle names the PDF's own pages (the file is keyed by the
   * PDF's hash). `by-position`: an old file, which knew only page numbers.
   */
  pages: "same" | "by-position";
  /** Annotations of an old file that could not be converted. */
  skipped: number;
}

/**
 * The annotations in a file's text; undefined when it is not one. Rejects
 * with the engine's error for a bundle that is damaged (a drawing that does
 * not match its hash) or too large, which `undefined` would hide.
 */
export async function parseAnnotations(
  text: string,
): Promise<StoredAnnotations | undefined> {
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(file)) {
    return undefined;
  }
  if (file.version === ANNOTATION_STORE_VERSION && isRecord(file.bundle)) {
    const bundle = await AnnotationTransfer.parse(JSON.stringify(file.bundle));
    return { bundle, pages: "same", skipped: 0 };
  }
  if (file.version === 1 && Array.isArray(file.annotations)) {
    return parseLegacyAnnotations(text);
  }
  return undefined;
}

async function parseLegacyAnnotations(
  text: string,
): Promise<StoredAnnotations | undefined> {
  const file = JSON.parse(text, (_key, value: unknown) => revive(value)) as {
    annotations: unknown[];
  };
  if (!file.annotations.every(isLegacyAnnotation)) {
    return undefined;
  }
  const { bundle, skipped } = await legacyToBundle(file.annotations);
  return { bundle, pages: "by-position", skipped };
}

/**
 * The bundle with only the annotations Lumia owns: what the file keeps.
 * A reply or popup goes with the annotation it belongs to, and the drawings
 * no kept annotation names are left out (a bundle that names none is refused).
 */
export function keepOwned(
  bundle: AnnotationBundle,
  isOwn: (ref: AnnotationRef) => boolean,
): AnnotationBundle {
  const items = bundle.items.filter(({ data }) => {
    const owner =
      data.subtype === "popup" ? data.parent : (data.reply?.to ?? null);
    return isOwn(data.ref) || (owner !== null && isOwn(owner));
  });
  const named = new Set<string>(
    items.flatMap((item) => Object.values(item.resources)),
  );
  const resources = Object.fromEntries(
    Object.entries(bundle.resources).filter(([id]) => named.has(id)),
  );
  return { ...bundle, items, resources } as AnnotationBundle;
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

/** An old file tagged its dates and bytes, which JSON has no types for. */
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLegacyAnnotation(item: unknown): item is LegacyAnnotation {
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

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
