/**
 * Pairing the blocks of one replaced run (blocks removed, blocks added) into
 * rows. A removed block sits beside the added block it most resembles, as
 * VS Code's diff keeps an edited line beside its old version; what is left
 * between those pairs pairs up in order when kinds match.
 */
import type { Block, BlockRow } from "./blocks";
import { tokens } from "./lines";

/** Past this many removed × added blocks, pair in order only. */
const MAX_CELLS = 2_500;
/** How alike (Dice over words) two blocks must be to pair across others. */
const MIN_SIMILARITY = 0.5;

type Bag = { readonly counts: Map<string, number>; readonly size: number };

/** A list marker and task box: renumbering an item does not make it alike. */
const MARKER = /^ {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+(?:\[.\][ \t]+)?/;
const WORD = /[\p{L}\p{N}]/u;

function bag(text: string): Bag {
  const counts = new Map<string, number>();
  let size = 0;
  for (const token of tokens(text.replace(MARKER, ""))) {
    if (WORD.test(token)) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
      size++;
    }
  }
  return { counts, size };
}

/** Dice coefficient of two word bags, iterating the smaller one. */
function similarity(x: Bag, y: Bag): number {
  if (x.size === 0 || y.size === 0) {
    return 0;
  }
  const [small, large] = x.counts.size <= y.counts.size ? [x, y] : [y, x];
  let shared = 0;
  for (const [token, count] of small.counts) {
    shared += Math.min(count, large.counts.get(token) ?? 0);
  }
  return (2 * shared) / (x.size + y.size);
}

/** Order-preserving pairs (removed index, added index) of most total likeness. */
function anchors(
  removed: readonly Block[],
  added: readonly Block[],
): [number, number][] {
  const n = removed.length;
  const m = added.length;
  if (n === 0 || m === 0 || n * m > MAX_CELLS) {
    return [];
  }
  const a = removed.map((block) => bag(block.text));
  const b = added.map((block) => bag(block.text));
  const like = (i: number, j: number) =>
    removed[i]!.kind === added[j]!.kind ? similarity(a[i]!, b[j]!) : 0;
  // score[i][j]: best total over removed[i..] and added[j..].
  const score = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  const take = Array.from({ length: n }, () => new Array<number>(m).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const s = like(i, j);
      take[i]![j] = s >= MIN_SIMILARITY ? s : 0;
      score[i]![j] = Math.max(
        score[i + 1]![j]!,
        score[i]![j + 1]!,
        take[i]![j]! > 0 ? take[i]![j]! + score[i + 1]![j + 1]! : 0,
      );
    }
  }
  const out: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const t = take[i]![j]!;
    if (t > 0 && score[i]![j] === t + score[i + 1]![j + 1]!) {
      out.push([i++, j++]);
    } else if (score[i]![j] === score[i + 1]![j]) {
      i++;
    } else {
      j++;
    }
  }
  return out;
}

/** Pair in order: same-kind blocks side by side, the rest on their own. */
function inOrder(removed: readonly Block[], added: readonly Block[]) {
  const rows: BlockRow[] = [];
  let i = 0;
  let j = 0;
  while (i < removed.length || j < added.length) {
    const x = removed[i];
    const y = added[j];
    if (x && y && x.kind === y.kind) {
      rows.push({ kind: "modified", before: x, after: y });
      i++;
      j++;
    } else if (x && (!y || removed.length - i >= added.length - j)) {
      rows.push({ kind: "deleted", before: x });
      i++;
    } else {
      rows.push({ kind: "added", after: y! });
      j++;
    }
  }
  return rows;
}

export function pairBlocks(
  removed: readonly Block[],
  added: readonly Block[],
): BlockRow[] {
  const rows: BlockRow[] = [];
  let i = 0;
  let j = 0;
  for (const [x, y] of anchors(removed, added)) {
    rows.push(...inOrder(removed.slice(i, x), added.slice(j, y)));
    rows.push({ kind: "modified", before: removed[x]!, after: added[y]! });
    i = x + 1;
    j = y + 1;
  }
  rows.push(...inOrder(removed.slice(i), added.slice(j)));
  return rows;
}
