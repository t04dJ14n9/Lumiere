import type { Tree } from "@lezer/common";
import { markdownParser as language, parseMarkdown } from "../dialect/parser";
import type { Text } from "@codemirror/state";
import { footnoteDefinitions } from "./footnote-definitions";
import {
  collectFootnoteCandidates,
  type FootnoteCandidate,
} from "./footnote-candidates";

export interface Footnote {
  label: string;
  from: number;
  marker: number;
  to: number;
  text: string;
  number?: number;
  references: number[];
  segments?: { from: number; to: number; offset: number }[];
}
export interface Footnotes {
  definitions: Footnote[];
  references: Map<number, Footnote>;
}

const registries = new WeakMap<Text, Footnotes>();
const partialRegistries = new WeakMap<
  Text,
  { length: number; registry: Footnotes }
>();

/**
 * `extractFootnotes`, once per document (shared by metadata and Live
 * Preview). Given a tree that covers only the start of a large note (Live
 * Preview's, while the rest parses in the background), it uses that tree
 * instead of parsing the whole note at once: references there are numbered
 * exactly (a number depends only on the references before it), and
 * definitions are found line by line as always (the tree only rules out
 * those in code). Such a registry is not kept as the document's.
 */
export function footnoteRegistry(doc: Text, existingTree?: Tree): Footnotes {
  const complete = registries.get(doc);
  if (complete) {
    return complete;
  }
  if (existingTree && existingTree.length < doc.length) {
    const partial = partialRegistries.get(doc);
    if (partial && partial.length >= existingTree.length) {
      return partial.registry;
    }
    const registry = extractFootnotes(doc, existingTree);
    partialRegistries.set(doc, { length: existingTree.length, registry });
    return registry;
  }
  const registry = extractFootnotes(doc, existingTree);
  registries.set(doc, registry);
  return registry;
}

/**
 * Hand `from`'s footnotes on to `to`, the next version of the document,
 * through an edit that changed none of them: the same footnotes, numbered
 * the same, at positions moved by `map`. Nothing happens if `from` has none
 * yet or `to` already has some.
 */
export function carryFootnotes(
  from: Text,
  to: Text,
  map: (position: number) => number,
): void {
  const complete = registries.get(from);
  if (complete && !registries.has(to)) {
    registries.set(to, mapFootnotes(complete, map));
    return;
  }
  const partial = partialRegistries.get(from);
  if (partial && !registries.has(to) && !partialRegistries.has(to)) {
    partialRegistries.set(to, {
      length: map(partial.length),
      registry: mapFootnotes(partial.registry, map),
    });
  }
}

/** The footnotes known for `doc`, complete or not, without extracting any. */
export function knownFootnotes(doc: Text): Footnotes | undefined {
  return registries.get(doc) ?? partialRegistries.get(doc)?.registry;
}

function mapFootnotes(
  registry: Footnotes,
  map: (position: number) => number,
): Footnotes {
  const moved = new Map<Footnote, Footnote>();
  const move = (note: Footnote): Footnote => {
    let next = moved.get(note);
    if (!next) {
      next = {
        ...note,
        from: map(note.from),
        marker: map(note.marker),
        to: map(note.to),
        references: note.references.map(map),
        ...(note.segments && {
          segments: note.segments.map((segment) => ({
            ...segment,
            from: map(segment.from),
            to: map(segment.to),
          })),
        }),
      };
      moved.set(note, next);
    }
    return next;
  };
  return {
    definitions: registry.definitions.map(move),
    references: new Map(
      [...registry.references].map(([at, note]) => [map(at), move(note)]),
    ),
  };
}

export function extractFootnotes(doc: Text, existingTree?: Tree): Footnotes {
  const source = doc.toString();
  if (!source.includes("[^") && !source.includes("^[")) {
    const empty: Footnotes = { definitions: [], references: new Map() };

    return empty;
  }
  const tree = existingTree ?? parseMarkdown(doc);
  const definitions = footnoteDefinitions(doc, tree);
  const candidates = collectFootnoteCandidates({
    text: source,
    syntax: tree,
    definitions,
    position: (at) => at,
  });
  for (const note of definitions) {
    if (!note.text.includes("[^") && !note.text.includes("^[")) {
      continue;
    }
    candidates.push(
      ...collectFootnoteCandidates({
        text: note.text,
        syntax: language.parse(note.text),
        definitions,
        inDefinition: true,
        position: (at) => definitionPosition(note.segments, at),
      }),
    );
  }
  return { definitions, references: numberReferences(definitions, candidates) };
}

function numberReferences(
  definitions: Footnote[],
  candidates: FootnoteCandidate[],
): Map<number, Footnote> {
  const labels = new Map(definitions.map((note) => [note.label, note]));
  const references = new Map<number, Footnote>();
  let count = 0;
  for (const candidate of candidates.sort((a, b) => a.from - b.from)) {
    if (candidate.text !== undefined) {
      const note: Footnote = {
        label: "",
        from: candidate.from,
        marker: candidate.from,
        to: candidate.to,
        text: candidate.text,
        number: ++count,
        references: [candidate.from],
      };
      references.set(candidate.from, note);
      continue;
    }
    const note = labels.get(candidate.label!);
    if (!note) {
      continue;
    }
    note.number ??= ++count;
    note.references.push(candidate.from);
    references.set(candidate.from, note);
  }
  return references;
}

export function definitionPosition(
  segments: Footnote["segments"],
  at: number,
): number | undefined {
  const segment = segments?.find(
    (segment) =>
      at >= segment.offset && at <= segment.offset + segment.to - segment.from,
  );
  return segment ? segment.from + at - segment.offset : undefined;
}
