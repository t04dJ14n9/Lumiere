import type { Document } from "yaml";
import { headerParts } from "../properties/header-parts";
import { loadYaml } from "../properties/load-yaml";
import { wikiTarget } from "../html/helpers";
import type { NoteMetadata, Position } from "./types";

export type FrontmatterYaml = {
  body: string;
  document: Document;
  offset: number;
};

/** A string value in the frontmatter, with its YAML quoting style. */
export interface FrontmatterScalar {
  /** Dotted property path, `list.0` for a list item. */
  key: string;
  /** Source offsets of the scalar, quotes included. */
  from: number;
  to: number;
  /** `yaml`'s scalar type: `PLAIN`, `QUOTE_SINGLE`, `QUOTE_DOUBLE`, `BLOCK_…`. */
  style: string;
  value: string;
}

/**
 * Every string value of the frontmatter, never comments or keys, with
 * offsets into the note's source. Pass `parsed` from `frontmatter().yaml` to
 * skip a second `parseDocument` on the cold metadata path.
 */
export function frontmatterScalars(
  source: string,
  parsed?: FrontmatterYaml,
): FrontmatterScalar[] {
  const yaml = parsed ?? parseFrontmatterYaml(source);
  if (!yaml) {
    return [];
  }
  const { isMap, isSeq, isScalar } = loadYaml();
  const offset = yaml.offset;
  const scalars: FrontmatterScalar[] = [];
  function visit(node: unknown, key: string, depth: number): void {
    if (depth > 64) {
      return;
    }
    if (isMap(node)) {
      for (const pair of node.items) {
        if (isScalar(pair.key)) {
          visit(
            pair.value,
            key ? `${key}.${String(pair.key.value)}` : String(pair.key.value),
            depth + 1,
          );
        }
      }
    } else if (isSeq(node)) {
      node.items.forEach((item, index) =>
        visit(item, `${key}.${index}`, depth + 1),
      );
    } else if (isScalar(node) && typeof node.value === "string" && node.range) {
      scalars.push({
        key,
        from: offset + node.range[0],
        to: offset + node.range[1],
        style: node.type ?? "PLAIN",
        value: node.value,
      });
    }
  }
  visit(yaml.document.contents, "", 0);
  return scalars;
}

/**
 * The text a link's source span stands for inside a quoted scalar: `''` is
 * one `'` in single quotes, and `\"` one `"` in double quotes. Plain and
 * block scalars take their text as written.
 */
export function decodeScalarText(raw: string, style: string): string {
  if (style === "QUOTE_SINGLE") {
    return raw.replace(/''/g, "'");
  }
  if (style === "QUOTE_DOUBLE") {
    return raw.replace(/\\(["\\/])/g, "$1");
  }
  return raw;
}

/** The inverse of `decodeScalarText`, for text written into a scalar. */
export function encodeScalarText(text: string, style: string): string {
  if (style === "QUOTE_SINGLE") {
    return text.replace(/'/g, "''");
  }
  if (style === "QUOTE_DOUBLE") {
    return text.replace(/[\\"]/g, (character) => `\\${character}`);
  }
  return text;
}

/**
 * Wikilinks in frontmatter values; ranges keep their source offsets, and a
 * link in a quoted value names the file its decoded text does (`'[[Bob''s]]'`
 * links to `Bob's`).
 */
export function frontmatterLinks(
  source: string,
  position: (from: number, to: number) => Position,
  parsed?: FrontmatterYaml,
): NoteMetadata["frontmatterLinks"] {
  const links: NoteMetadata["frontmatterLinks"] = [];
  for (const scalar of frontmatterScalars(source, parsed)) {
    const raw = source.slice(scalar.from, scalar.to);
    for (const match of raw.matchAll(/!?\[\[([^\]\n]+)\]\]/g)) {
      const from = scalar.from + match.index;
      links.push({
        key: scalar.key,
        link: wikiTarget(decodeScalarText(match[1]!, scalar.style)).target,
        original: match[0],
        position: position(from, from + match[0].length),
      });
    }
  }
  return links;
}

function parseFrontmatterYaml(source: string): FrontmatterYaml | undefined {
  const header = headerParts(source);
  if (!header) {
    return undefined;
  }
  const { parseDocument } = loadYaml();
  const document = parseDocument(header.body, { uniqueKeys: true });
  if (document.errors.length) {
    return undefined;
  }
  return { body: header.body, document, offset: header.offset };
}
