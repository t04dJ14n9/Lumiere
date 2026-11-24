import { createRenderer } from "../../../../src/markdown/html";
import {
  fileName,
  sideLabel,
} from "../../../../src/plugins/gitDiffEditor/host";
import {
  blockDefinitions,
  citations,
  containerParagraphs,
  definitions,
  paragraphDefinitions,
} from "../../../../src/webview/diff/definitions";
import { diffRows } from "../../../../src/webview/diff/rows";
import type { Target } from "../target";

const block = (text: string) => ({
  kind: "text" as const,
  text,
  from: 0,
  to: 1,
});
const renderer = createRenderer();

/**
 * Both diffRows targets are judged by growth, not by time: each text runs at
 * 8k and at 32k characters (4x), and the time may not grow more than 8x.
 * Linear work grows 4x, quadratic 16x. Judged by time, the identity renderer
 * took 13-14 s of its 20 s deadline on Windows CI (3.8 s locally) and the
 * production renderer 22-44 s of 45 s, mostly Myers' fixed cost per diff with
 * nothing in common: the same at any size, and already checked on such pairs
 * by the diff targets (./diff.ts).
 */
const growth = { small: 8000, large: 32_000, maxRatio: 8, floorMs: 20 };

export const targets: Record<string, Target> = {
  definitions: { arity: 1, run: (a) => definitions(block(a)) },
  blockDefinitions: { arity: 1, run: (a) => blockDefinitions(block(a)) },
  paragraphDefinitions: { arity: 1, run: paragraphDefinitions },
  containerParagraphs: { arity: 1, run: containerParagraphs },
  citations: { arity: 1, run: citations },
  sideLabel: { arity: 1, run: (a) => sideLabel(`git:/n.md?${a}`) },
  fileName: { arity: 1, run: (a) => fileName(`file:///${a}?${a}`) },
  // Our row building, with the renderer replaced by identity...
  diffRows: {
    arity: 2,
    scaling: growth,
    run: (a, b) => diffRows(a, b, (m) => m),
  },
  // ...and with the production renderer (markdown-it and our plugins).
  diffRowsRendered: {
    arity: 2,
    deadlineMs: 45_000,
    scaling: growth,
    run: (a, b) => diffRows(a, b, (m) => renderer.renderMarkdown(m)),
  },
};
