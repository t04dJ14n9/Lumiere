import { createHash } from "node:crypto";
import type { AnnotationBundle } from "@embedpdf/engine-core/public";

export type Ref = AnnotationBundle["items"][number]["data"]["ref"];

const page = (objectNumber: number) =>
  ({ kind: "objectNumber", objectNumber }) as const;

/** An annotation's ref: object `objectNumber` on page `onPage`. */
export const refOn = (objectNumber: number, onPage = 5): Ref => ({
  kind: "objectNumber",
  page: page(onPage),
  objectNumber,
});

/**
 * A bundle of annotations on page 5 (position 0) with just the fields a test
 * names. `drawing` is a stamp's image, kept under its hash as EmbedPDF does.
 * Enough for the bundle codec, which checks its shape and resources, not
 * each kind's fields.
 */
export function bundle(
  items: Array<{
    ref: Ref;
    subtype?: string;
    drawing?: Uint8Array;
    [field: string]: unknown;
  }>,
): AnnotationBundle {
  const resources: Record<string, Uint8Array> = {};
  const rows = items.map(({ ref, subtype, drawing, ...fields }) => {
    const named: Record<string, string> = {};
    if (drawing) {
      const id = `sha256-${createHash("sha256").update(drawing).digest("hex")}`;
      resources[id] = drawing;
      named.appearance = id;
    }
    return {
      data: { subtype: subtype ?? "highlight", ref, ...fields },
      resources: named,
    };
  });
  return {
    format: "embedpdf/annotations",
    version: 1,
    pages: [{ page: page(5), position: 0, size: { width: 300, height: 400 } }],
    items: rows,
    resources,
  } as unknown as AnnotationBundle;
}
