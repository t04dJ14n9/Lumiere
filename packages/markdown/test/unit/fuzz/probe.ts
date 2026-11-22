/**
 * Child-process half of the fuzz harness. argv: <target file> <target name>.
 * Runs the target on every input (and on each input paired with a small
 * baseline, both ways, for two-text targets), printing one JSON line per
 * case *before* it starts and one after, so the parent can name a case that
 * stalled when it has to kill this process.
 *
 * A target with `scaling` runs each case at two sizes instead, and the line
 * after it carries both times.
 */
import { pathToFileURL } from "node:url";
import { INPUTS, inputsOfSize } from "./inputs";
import { growsTooFast } from "./target";
import type { Scaling, Target } from "./target";

type Case = [label: string, go: () => unknown];

/** Re-measurements of a case that looks too slow, before it is reported. */
const RETRIES = 2;

function casesOf(target: Target, input: string, text: string): Case[] {
  if (target.arity === 1) {
    return [[input, () => target.run(text, "")]];
  }
  const grown: Case = [
    `${input}/adv→adv+`,
    () => target.run(text, `${text} new`),
  ];
  // Setting the text against a baseline only adds the fixed cost of a diff
  // with nothing in common, which is the same at any size. A target judged
  // by growth gets the pairing that does its work on the text twice.
  return target.scaling
    ? [grown]
    : [
        [`${input}/old→adv`, () => target.run("prose old\n", text)],
        [`${input}/adv→old`, () => target.run(text, "prose old\n")],
        grown,
      ];
}

function time(go: () => unknown): number {
  const started = performance.now();
  go();
  return performance.now() - started;
}

/**
 * One run of each size; a case that looks too slow is measured again and
 * the best of each size kept, because a stall of the machine in the middle
 * of one run is not growth, whereas real growth shows in every run.
 */
function timeBoth(scaling: Scaling, small: Case, large: Case) {
  let smallMs = time(small[1]);
  let largeMs = time(large[1]);
  for (let i = 0; i < RETRIES && growsTooFast(scaling, smallMs, largeMs); i++) {
    smallMs = Math.min(smallMs, time(small[1]));
    largeMs = Math.min(largeMs, time(large[1]));
  }
  return { ms: largeMs, smallMs };
}

async function main(): Promise<void> {
  const [file, name] = process.argv.slice(2);
  // An absolute Windows path (D:\...) is not a module specifier; its file URL is.
  const loaded = (await import(pathToFileURL(file!).href)) as {
    targets: Record<string, Target>;
  };
  const target = loaded.targets[name!]!;
  const { scaling } = target;
  const small = scaling && inputsOfSize(scaling.small);
  const large = scaling ? inputsOfSize(scaling.large) : INPUTS;
  for (const [input, text] of Object.entries(large)) {
    const cases = casesOf(target, input, text);
    const smallCases = small && casesOf(target, input, small[input]!);
    for (const [i, large] of cases.entries()) {
      process.stdout.write(`${JSON.stringify({ start: large[0] })}\n`);
      const timed = smallCases
        ? timeBoth(scaling, smallCases[i]!, large)
        : { ms: time(large[1]) };
      process.stdout.write(`${JSON.stringify({ done: large[0], ...timed })}\n`);
    }
  }
}

void main();
