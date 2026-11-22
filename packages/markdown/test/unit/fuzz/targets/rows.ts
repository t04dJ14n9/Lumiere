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

export const targets: Record<string, Target> = {
  definitions: { arity: 1, run: (a) => definitions(block(a)) },
  blockDefinitions: { arity: 1, run: (a) => blockDefinitions(block(a)) },
  paragraphDefinitions: { arity: 1, run: paragraphDefinitions },
  containerParagraphs: { arity: 1, run: containerParagraphs },
  citations: { arity: 1, run: citations },
  sideLabel: { arity: 1, run: (a) => sideLabel(`git:/n.md?${a}`) },
  fileName: { arity: 1, run: (a) => fileName(`file:///${a}?${a}`) },
  // Our row building, with the renderer replaced by identity...
  diffRows: { arity: 2, run: (a, b) => diffRows(a, b, (m) => m) },
  // ...and with the production renderer (markdown-it and our plugins). A
  // full render of ~210 adversarial cases at 100k characters took 22-44 s on
  // Windows CI against a 45 s deadline, so this one is judged by growth, not
  // by time: each text runs at 8k and at 32k characters (4x), and the time
  // may not grow more than 8x. Linear work grows 4x, quadratic 16x.
  diffRowsRendered: {
    arity: 2,
    deadlineMs: 45_000,
    scaling: { small: 8000, large: 32_000, maxRatio: 8, floorMs: 20 },
    run: (a, b) => diffRows(a, b, (m) => renderer.renderMarkdown(m)),
  },
};
