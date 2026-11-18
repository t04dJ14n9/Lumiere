import type { Infer } from "@workshop/core";
import { HARD_MAX_PAYLOAD_BYTES } from "./admission";
import { graphFacets } from "./facets";
import type { GraphFilters } from "./filters";
import type { protocol } from "./protocol";
import { buildNoteGraph } from "./project";
import type { LinkSyntax } from "../../shared/vault-path";
import type { GraphNote, ResolvedTarget } from "./project";
import type { GraphScope } from "./scope";
import { drawGraph } from "./view";
import type { DrawnNode } from "./view";

export type GraphSnapshot = Infer<(typeof protocol.notifications)["snapshot"]>;

export interface SnapshotRequest {
  scope: GraphScope;
  notes: readonly GraphNote[];
  resolve(
    linktext: string,
    sourcePath: string,
    syntax: LinkSyntax,
  ): ResolvedTarget;
  completeness: GraphSnapshot["completeness"];
  generation: number;
  mode: "global" | "local";
  depth: number;
  colorBy: "type" | "folder" | "tag";
  filters: GraphFilters;
  focusPath?: string;
  maxNodes: number;
  maxEdges: number;
}

const EMPTY_REASON =
  "No vault folder is open. Open a folder to draw its notes.";

/** A panel with nowhere to draw. The generation still moves so a stale graph clears. */
export function emptySnapshot(generation: number): GraphSnapshot {
  return {
    scopeId: "",
    generation,
    completeness: "ready",
    scopeName: "",
    scopePath: "",
    mode: "global",
    depth: 2,
    colorBy: "type",
    focusExcluded: false,
    accepted: true,
    nodeCount: 0,
    edgeCount: 0,
    reason: EMPTY_REASON,
    nodes: [],
    edges: [],
    legend: [],
    facets: { types: [], tags: [], folders: [] },
  };
}

/** Project the vault, draw the requested view, and refuse an oversized payload. */
export function presentSnapshot(request: SnapshotRequest): GraphSnapshot {
  const graph = buildNoteGraph({
    notes: request.notes,
    resolve: request.resolve,
  });
  const focusId =
    request.focusPath && request.focusPath.length <= 1024
      ? request.focusPath
      : undefined;
  const drawn = drawGraph(graph, {
    mode: request.mode,
    depth: request.depth,
    colorBy: request.colorBy,
    filters: request.filters,
    ...(focusId ? { focusId } : {}),
    maxNodes: request.maxNodes,
    maxEdges: request.maxEdges,
  });
  const snapshot: GraphSnapshot = {
    scopeId: clip(request.scope.id, 2048),
    generation: request.generation,
    completeness: request.completeness,
    scopeName: clip(request.scope.name, 500),
    scopePath: clip(request.scope.vaultRoot, 1024),
    mode: request.mode,
    depth: request.depth,
    colorBy: request.colorBy,
    focusExcluded: drawn.focusExcluded,
    accepted: drawn.accepted,
    nodeCount: drawn.nodeCount,
    edgeCount: drawn.edgeCount,
    ...(drawn.reason ? { reason: clip(drawn.reason, 500) } : {}),
    nodes: fittedNodes(drawn.nodes),
    edges: fittedEdges(drawn.edges, fittedNodes(drawn.nodes)),
    legend: drawn.legend.map((entry) => ({
      key: clip(entry.key, 200),
      color: clip(entry.color, 16),
      count: entry.count,
    })),
    facets: graphFacets(graph),
  };
  return guardPayload(snapshot);
}

function fittedNodes(nodes: readonly DrawnNode[]): GraphSnapshot["nodes"] {
  return nodes.flatMap((node) => fittedNode(node));
}

function fittedEdges(
  edges: GraphSnapshot["edges"],
  nodes: GraphSnapshot["nodes"],
): GraphSnapshot["edges"] {
  const ids = new Set(nodes.map((node) => node.id));
  return edges
    .flatMap((edge) => fittedEdge(edge))
    .filter((edge) => ids.has(edge.source) && ids.has(edge.target));
}

function fittedNode(node: DrawnNode): GraphSnapshot["nodes"] {
  if (node.id.length > 1024 || node.path.length > 1024) {
    return [];
  }
  const description = node.description
    ? clip(node.description, 4000)
    : undefined;
  const type = node.type ? clip(node.type, 200) : undefined;
  return [
    {
      id: node.id,
      title: clip(node.title, 500),
      path: node.path,
      folder: clip(node.folder, 1024),
      tags: node.tags.slice(0, 50).map((tag) => clip(tag, 200)),
      indexing: node.indexing,
      degree: node.degree,
      orphan: node.orphan,
      unresolved: node.unresolved,
      color: clip(node.color, 16),
      colorKey: clip(node.colorKey, 200),
      ...(description ? { description } : {}),
      ...(type ? { type } : {}),
    },
  ];
}

function fittedEdge(
  edge: GraphSnapshot["edges"][number],
): GraphSnapshot["edges"] {
  if (edge.source.length > 1024 || edge.target.length > 1024) {
    return [];
  }
  return [{ ...edge, id: clip(edge.id, 2100) }];
}

function guardPayload(snapshot: GraphSnapshot): GraphSnapshot {
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot)).length;
  if (bytes <= HARD_MAX_PAYLOAD_BYTES) {
    return snapshot;
  }
  return {
    ...snapshot,
    accepted: false,
    nodes: [],
    edges: [],
    legend: [],
    reason: "This graph is too large to draw. Narrow the filters.",
  };
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}
