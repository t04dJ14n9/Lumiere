import type { NoteMetadata } from "../../markdown/metadata";
import { linkpathOf, linkSyntax } from "../../markdown/metadata/linkpaths";
import {
  extensionOf,
  folderOf,
  isMarkdownPath,
  stemOf,
  type LinkSyntax,
} from "../../shared/vault-path";

export interface GraphNote {
  path: string;
  metadata?: NoteMetadata;
}

export interface ResolvedTarget {
  status: "file" | "missing";
  path?: string;
}

export interface NoteNode {
  id: string;
  path: string;
  title: string;
  description?: string;
  type?: string;
  folder: string;
  tags: readonly string[];
  /** Its metadata is not parsed yet. */
  indexing: boolean;
  degree: number;
  orphan: boolean;
  unresolved: number;
  assets: number;
  outOfScope: number;
}

export interface NoteEdge {
  id: string;
  source: string;
  target: string;
  count: number;
}

export interface NoteGraph {
  nodes: NoteNode[];
  edges: NoteEdge[];
}

interface EdgeHit {
  kind: "note" | "asset" | "out-of-scope" | "unresolved" | "self";
  path?: string;
}

/** Note graph for one vault. Edges are directed and aggregated. */
export function buildNoteGraph(input: {
  notes: readonly GraphNote[];
  resolve(
    linktext: string,
    sourcePath: string,
    syntax: LinkSyntax,
  ): ResolvedTarget;
}): NoteGraph {
  const nodes = noteNodes(input.notes);
  const byPath = new Map(nodes.map((node) => [node.path, node]));
  const counts = new Map<string, number>();
  const neighbours = new Map<string, Set<string>>(
    nodes.map((node) => [node.id, new Set()]),
  );
  for (const note of input.notes) {
    const source = byPath.get(note.path);
    if (!source || !note.metadata) {
      continue;
    }
    for (const link of noteLinks(note.metadata)) {
      const hit = classifyHit(input, source.path, link, byPath);
      if (hit) {
        recordHit(source, hit, counts, neighbours);
      }
    }
  }
  for (const node of nodes) {
    const degree = neighbours.get(node.id)?.size ?? 0;
    node.degree = degree;
    node.orphan = degree === 0;
  }
  return { nodes, edges: edgesFrom(counts) };
}

function noteNodes(notes: readonly GraphNote[]): NoteNode[] {
  return notes
    .filter((note) => isMarkdownPath(note.path))
    .map((note) => {
      const frontmatter = note.metadata?.frontmatter;
      const description = frontmatterText(frontmatter, "description");
      const type = frontmatterText(frontmatter, "type");
      return {
        id: note.path,
        path: note.path,
        title: frontmatterText(frontmatter, "title") ?? stemOf(note.path),
        ...(description ? { description } : {}),
        ...(type ? { type } : {}),
        folder: folderOf(note.path),
        tags: frontmatterTags(frontmatter),
        indexing: note.metadata === undefined,
        degree: 0,
        orphan: true,
        unresolved: 0,
        assets: 0,
        outOfScope: 0,
      };
    });
}

/** A non-empty string property, trimmed. Objects and lists are never labels. */
function frontmatterText(
  frontmatter: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = frontmatter?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Frontmatter tags only: a single string or a list of strings. */
function frontmatterTags(
  frontmatter: Record<string, unknown> | undefined,
): string[] {
  const tags = frontmatter?.tags;
  if (typeof tags === "string" && tags.trim()) {
    return [tags.trim()];
  }
  if (!Array.isArray(tags)) {
    return [];
  }
  return tags.flatMap((tag) =>
    typeof tag === "string" && tag.trim() ? [tag.trim()] : [],
  );
}

/** Body links/embeds plus frontmatter wikilinks (Obsidian graph includes both). */
function noteLinks(metadata: NoteMetadata) {
  return [...metadata.links, ...metadata.embeds, ...metadata.frontmatterLinks];
}

function classifyHit(
  input: {
    resolve(
      linktext: string,
      sourcePath: string,
      syntax: LinkSyntax,
    ): ResolvedTarget;
  },
  sourcePath: string,
  link: ReturnType<typeof noteLinks>[number],
  nodes: Map<string, NoteNode>,
): EdgeHit | undefined {
  const linktext = linkpathOf(link);
  if (!linktext) {
    return undefined;
  }
  const target = input.resolve(linktext, sourcePath, linkSyntax(link));
  if (target.status === "missing" || !target.path) {
    return { kind: "unresolved" };
  }
  return classifyResolvedPath(sourcePath, target.path, nodes);
}

function classifyResolvedPath(
  sourcePath: string,
  targetPath: string,
  nodes: Map<string, NoteNode>,
): EdgeHit {
  if (targetPath === sourcePath) {
    return { kind: "self" };
  }
  if (!isMarkdownPath(targetPath) || extensionOf(targetPath) !== "md") {
    return { kind: "asset", path: targetPath };
  }
  if (!nodes.has(targetPath)) {
    return { kind: "out-of-scope", path: targetPath };
  }
  return { kind: "note", path: targetPath };
}

function recordHit(
  source: NoteNode,
  hit: EdgeHit,
  counts: Map<string, number>,
  neighbours: Map<string, Set<string>>,
): void {
  if (hit.kind === "unresolved") {
    source.unresolved += 1;
    return;
  }
  if (hit.kind === "asset") {
    source.assets += 1;
    return;
  }
  if (hit.kind === "out-of-scope") {
    source.outOfScope += 1;
    return;
  }
  if (hit.kind === "self" || !hit.path) {
    return;
  }
  const key = `${source.id}\0${hit.path}`;
  counts.set(key, (counts.get(key) ?? 0) + 1);
  neighbours.get(source.id)?.add(hit.path);
  neighbours.get(hit.path)?.add(source.id);
}

function edgesFrom(counts: Map<string, number>): NoteEdge[] {
  return [...counts].map(([key, count]) => {
    const [source = "", target = ""] = key.split("\0");
    return { id: `${source}->${target}`, source, target, count };
  });
}
