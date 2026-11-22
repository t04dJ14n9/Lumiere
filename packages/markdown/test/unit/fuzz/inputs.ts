/**
 * Adversarial texts for the fuzz harness: long runs of the characters
 * Markdown and diff regexes care about, at 80k-110k characters, alone and
 * embedded where a changed segment or a table/list/fence line would put them.
 * `inputsOfSize(n)` builds the same texts at other sizes, for a target judged
 * by how its time grows rather than by its time (see ./target.ts).
 */
const N = 100_000;
const run = (s: string, n: number) =>
  s.repeat(Math.ceil(n / s.length)).slice(0, n);

const runs: Record<string, string> = {
  spaces: " ",
  tabs: "\t",
  newlines: "\n",
  crlf: "\r\n",
  pipes: "|",
  dashes: "-",
  colons: ":",
  backticks: "`",
  tildes: "~",
  dollars: "$",
  hashes: "#",
  gt: ">",
  lt: "<",
  brackets: "[",
  closers: "]",
  caret: "[^",
  parens: "(",
  linkopen: "](",
  quotes: '"',
  squotes: "'",
  stars: "*",
  underscores: "_",
  letters: "x",
  digits: "9",
  urlish: "a:/",
  wordspace: "a ",
  pipespace: "| ",
  dashspace: "- ",
  indentlist: "  - ",
  bom: "\u00a0",
};

export function inputsOfSize(n: number): Record<string, string> {
  const inputs: Record<string, string> = {};
  const most = (n * 4) / 5;
  const half = (n * 2) / 5;
  for (const [name, unit] of Object.entries(runs)) {
    inputs[name] = run(unit, n);
    // Inside a changed segment: non-space on both sides of the run.
    inputs[`${name}-inner`] = `a${run(unit, n - 2)}b`;
  }
  return Object.assign(inputs, {
    "indented-row": `${run(" ", most)}| a |`,
    "fence-spaces": `${run("`", half)}${run(" ", half)}x`,
    "fence-tildes": `~~~\n${run("~", half)}${run(" ", half)}x`,
    "separator-spaces": `|${run(" ", half)}|${run(" ", half)}x`,
    "def-title": `[g]: /u\n"${run("a", most)}`,
    "def-many": run("[g]:\n", n),
    "footnotes-open": run("[^a", n),
    "table-wide": `| a |\n| --- |\n| ${run("b ", most)} |`,
    "table-cell-spaces": `| a |\n| --- |\n| a${run(" ", most)}b |`,
    "list-deep": run("    ", most) + "- x",
  });
}

export const INPUTS = inputsOfSize(N);
