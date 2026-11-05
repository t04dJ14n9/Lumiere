/**
 * Cluster adjacent PDF Link annotations that share a destination into one
 * logical cite (Author + Year fragments, or a cite wrapped across a line).
 *
 * Academic PDFs often emit several LINK annotations with the same GoTo/URI
 * target a few points apart. Same destinations that appear again later on the
 * page stay separate clusters — only spatial adjacency merges.
 */

/** Device/top-left rectangle, same shape as EmbedPDF `Rect`. */
export interface PageLinkRect {
  origin: { x: number; y: number };
  size: { width: number; height: number };
}

/** One EmbedPDF LINK annotation reduced to geometry + open target. */
export interface PageLinkInput {
  id: string;
  rect: PageLinkRect;
  page?: number | undefined;
  top?: number | undefined;
  url?: string | undefined;
}

/** Adjacent same-destination fragments rendered as one clickable cite. */
export interface PageLinkCluster {
  /** Stable id from the first segment in reading order. */
  id: string;
  segmentIds: string[];
  segments: PageLinkRect[];
  page?: number | undefined;
  top?: number | undefined;
  url?: string | undefined;
}

/** Max horizontal gap (PDF points) between same-line cite fragments. */
const MAX_SAME_LINE_GAP = 8;

/** Tops closer than this (points) count as the same GoTo destination. */
const TOP_EPSILON = 0.5;

/**
 * Group adjacent same-target link rects. Segments within a cluster keep
 * reading order (y, then x).
 */
export function clusterPageLinks(
  links: readonly PageLinkInput[],
): PageLinkCluster[] {
  if (links.length === 0) {
    return [];
  }
  const ordered = inReadingOrder(links);
  const groups = adjacentDestinationGroups(ordered);
  return groups
    .sort((a, b) => compareReadingOrder(a[0]!, b[0]!))
    .map((group) => toCluster(group));
}

function inReadingOrder(links: readonly PageLinkInput[]): PageLinkInput[] {
  return links
    .map((link, index) => ({ link, index }))
    .sort((a, b) => {
      const byPos = compareReadingOrder(a.link, b.link);
      return byPos !== 0 ? byPos : a.index - b.index;
    })
    .map(({ link }) => link);
}

function compareReadingOrder(a: PageLinkInput, b: PageLinkInput): number {
  const dy = a.rect.origin.y - b.rect.origin.y;
  if (dy !== 0) {
    return dy;
  }
  return a.rect.origin.x - b.rect.origin.x;
}

/** Union-find over ordered links: merge only adjacent same-destination pairs. */
function adjacentDestinationGroups(
  ordered: readonly PageLinkInput[],
): PageLinkInput[][] {
  const parent = ordered.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) {
      root = parent[root]!;
    }
    let cursor = i;
    while (parent[cursor] !== root) {
      const next = parent[cursor]!;
      parent[cursor] = root;
      cursor = next;
    }
    return root;
  };
  for (let i = 0; i < ordered.length; i++) {
    for (let j = i + 1; j < ordered.length; j++) {
      const a = ordered[i]!;
      const b = ordered[j]!;
      if (!sameDestination(a, b)) {
        continue;
      }
      if (areOnSameLine(a.rect, b.rect)) {
        parent[find(j)] = find(i);
        continue;
      }
      // Skip wrap-merge only when BOTH fragments already have a same-line
      // same-destination partner (year-of-N + author-of-N+1). Allow wrap when
      // either side is orphan — e.g. multi-box author + year on the next line.
      if (
        areLineWrap(a.rect, b.rect) &&
        !(
          hasSameLineSameDestPartner(ordered, i) &&
          hasSameLineSameDestPartner(ordered, j)
        )
      ) {
        parent[find(j)] = find(i);
      }
    }
  }
  const groups = new Map<number, PageLinkInput[]>();
  for (let i = 0; i < ordered.length; i++) {
    const root = find(i);
    const group = groups.get(root);
    if (group) {
      group.push(ordered[i]!);
    } else {
      groups.set(root, [ordered[i]!]);
    }
  }
  return [...groups.values()];
}

function toCluster(group: PageLinkInput[]): PageLinkCluster {
  const first = group[0]!;
  return {
    id: first.id,
    segmentIds: group.map((link) => link.id),
    segments: group.map((link) => link.rect),
    page: first.page,
    top: first.top,
    url: first.url,
  };
}

function sameDestination(a: PageLinkInput, b: PageLinkInput): boolean {
  if (a.url !== undefined || b.url !== undefined) {
    return a.url !== undefined && b.url !== undefined && a.url === b.url;
  }
  if (a.page === undefined || b.page === undefined || a.page !== b.page) {
    return false;
  }
  if (a.top === undefined && b.top === undefined) {
    return true;
  }
  if (a.top === undefined || b.top === undefined) {
    return false;
  }
  return Math.abs(a.top - b.top) < TOP_EPSILON;
}

/** True when another same-destination link sits on the same line. */
function hasSameLineSameDestPartner(
  ordered: readonly PageLinkInput[],
  index: number,
): boolean {
  const link = ordered[index]!;
  for (let i = 0; i < ordered.length; i++) {
    if (i === index) {
      continue;
    }
    const other = ordered[i]!;
    if (sameDestination(link, other) && areOnSameLine(link.rect, other.rect)) {
      return true;
    }
  }
  return false;
}

function areOnSameLine(a: PageLinkRect, b: PageLinkRect): boolean {
  const maxHeight = Math.max(a.size.height, b.size.height);
  const aCenter = a.origin.y + a.size.height / 2;
  const bCenter = b.origin.y + b.size.height / 2;
  if (Math.abs(aCenter - bCenter) > maxHeight * 0.6) {
    return false;
  }
  const left = a.origin.x <= b.origin.x ? a : b;
  const right = a.origin.x <= b.origin.x ? b : a;
  const gap = right.origin.x - (left.origin.x + left.size.width);
  return gap >= -1 && gap <= MAX_SAME_LINE_GAP;
}

/**
 * Cite split across a line break: upper fragment ends further right, lower
 * fragment starts further left, with at most about one line of vertical gap.
 */
function areLineWrap(a: PageLinkRect, b: PageLinkRect): boolean {
  const upper = a.origin.y <= b.origin.y ? a : b;
  const lower = a.origin.y <= b.origin.y ? b : a;
  if (lower.origin.x >= upper.origin.x) {
    return false;
  }
  const maxHeight = Math.max(upper.size.height, lower.size.height);
  const gap = lower.origin.y - (upper.origin.y + upper.size.height);
  return gap >= -maxHeight * 0.5 && gap <= maxHeight * 1.25;
}
