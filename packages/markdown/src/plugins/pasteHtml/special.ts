export function mathMarkdown(node: HTMLElement): string | undefined {
  if (
    !node.matches(
      "mjx-container, .katex, .katex-display, .math, .math-inline, .math-display, .cm-hybrid-inline-math, .cm-hybrid-math-block",
    )
  ) {
    return undefined;
  }
  const tex =
    node.getAttribute("data-tex")?.trim() ||
    node.querySelector("[data-tex]")?.getAttribute("data-tex")?.trim() ||
    node
      .querySelector('annotation[encoding="application/x-tex"]')
      ?.textContent?.trim();
  if (!tex) {
    return undefined;
  }
  return isDisplayMath(node) ? `\n\n$$\n${tex}\n$$\n\n` : `$${tex}$`;
}
export function calloutMarkdown(
  node: HTMLElement,
  convert: (node: HTMLElement) => string,
): string | undefined {
  const type = node.getAttribute("data-callout")?.trim();
  if (!type) {
    return undefined;
  }
  const titleNode = node.querySelector<HTMLElement>(".callout-title-inner");
  let title = titleNode ? convert(titleNode).trim() : "";
  const defaultTitle = type.replace(/[-_]+/g, " ");
  if (title.toLowerCase().replace(/\s+/g, " ") === defaultTitle.toLowerCase()) {
    title = "";
  }
  const bodyNode = node.querySelector<HTMLElement>(".callout-content");
  const body = bodyNode ? convert(bodyNode).trim() : "";
  const fold = node.getAttribute("data-callout-fold") ?? "";
  const marker = fold === "+" || fold === "-" ? fold : "";
  const first = `> [!${type}]${marker}${title ? ` ${title}` : ""}`;
  const lines = body
    ? body.split("\n").map((line) => (line ? `> ${line}` : ">"))
    : [];
  return `\n\n${[first, ...lines].join("\n")}\n\n`;
}
/**
 * A `<pre>` with no `<code>` inside (GitHub and many documentation sites
 * highlight with spans in a bare `<pre>`), as a fenced block of its text.
 * Turndown's own rule needs `<pre><code>`, and otherwise escapes the code.
 */
export function preformattedMarkdown(node: HTMLElement): string {
  const code = preformattedText(node).replace(/\n$/, "");
  const longest = Math.max(
    0,
    ...(code.match(/`+/g) ?? []).map((run) => run.length),
  );
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `\n\n${fence}${codeLanguage(node)}\n${code}\n${fence}\n\n`;
}

export function isBarePre(node: HTMLElement): boolean {
  return node.nodeName === "PRE" && node.firstChild?.nodeName !== "CODE";
}

function preformattedText(node: Node): string {
  return Array.from(node.childNodes)
    .map((child) => {
      if (child.nodeName === "BR") {
        return "\n";
      }
      return child.nodeType === 3
        ? (child.textContent ?? "")
        : preformattedText(child);
    })
    .join("");
}

/** `language-x` on the block, or GitHub's `highlight-source-x` around it. */
function codeLanguage(node: HTMLElement): string {
  const classes = `${node.className} ${(node.parentNode as HTMLElement | null)?.className ?? ""}`;
  return (
    /(?:^|\s)(?:language|lang|highlight-source)-([\w+#.-]+)/.exec(
      classes,
    )?.[1] ?? ""
  );
}

export function tableMarkdown(
  node: HTMLElement,
  convert: (node: HTMLElement) => string,
): string {
  const rows = ownRows(node)
    .map(rowSlots)
    .filter((row) => row.length);
  const columns = Math.max(0, ...rows.map((row) => row.length));
  if (!columns) {
    return "";
  }
  // Compact, with each column's alignment and short rows left short, as
  // Obsidian writes a pasted table.
  const lines = rows.map(
    (row) =>
      `|${row.map((cell) => (cell ? cellMarkdown(cell, convert) : "")).join("|")}|`,
  );
  const header = rows[0]!;
  const rule = Array.from({ length: columns }, (_, index) =>
    alignmentRule(header[index]),
  );
  lines.splice(1, 0, `|${rule.join("|")}|`);
  return `\n\n${lines.join("\n")}\n\n`;
}

/**
 * The table's own rows, directly or in its head, bodies and foot. A table
 * nested in a cell keeps its rows: that cell converts them.
 */
function ownRows(table: Element): Element[] {
  return Array.from(table.children).flatMap((child) => {
    if (child.nodeName === "TR") {
      return [child];
    }
    return /^(THEAD|TBODY|TFOOT)$/.test(child.nodeName)
      ? Array.from(child.children).filter((row) => row.nodeName === "TR")
      : [];
  });
}

/**
 * A row's cells, one slot per column. Markdown tables cannot merge cells, so
 * a cell spanning columns is followed by empty slots for the columns it
 * covers (as Obsidian pastes it), and the cells after it keep their columns.
 * Row spans are left alone, as Obsidian leaves them.
 */
function rowSlots(row: Element): (HTMLElement | undefined)[] {
  return Array.from(row.children)
    .filter((cell) => /^(TD|TH)$/.test(cell.nodeName))
    .flatMap((cell) => {
      const span = Number.parseInt(cell.getAttribute("colspan") ?? "", 10);
      const extra = Number.isFinite(span) ? Math.max(0, span - 1) : 0;
      return [cell as HTMLElement, ...Array<undefined>(extra).fill(undefined)];
    });
}

/**
 * A cell on its one Markdown line: a line break inside it becomes `<br>`, as
 * Obsidian writes it (Shift+Enter in a table cell stores the same), and `|`
 * is escaped.
 */
function cellMarkdown(
  cell: HTMLElement,
  convert: (node: HTMLElement) => string,
): string {
  return convert(cell)
    .trim()
    .replace(/[ \t]*\r?\n[ \t]*/g, "<br>")
    .replace(/\|/g, "\\|");
}

/** A column's delimiter row cell: `:--`, `--:`, `:-:` or `---`. */
function alignmentRule(cell: HTMLElement | undefined): string {
  // Obsidian reads the align attribute, not CSS text-align.
  const align = (cell?.getAttribute("align") ?? "").toLowerCase();
  const rules: Record<string, string> = {
    left: ":--",
    right: "--:",
    center: ":-:",
  };
  return rules[align] ?? "---";
}

function isDisplayMath(node: HTMLElement): boolean {
  return (
    node.matches(".katex-display, .math-display, .cm-hybrid-math-block") ||
    node.getAttribute("data-display") === "true" ||
    node.querySelector("[data-display]")?.getAttribute("data-display") ===
      "true" ||
    (node.nodeName === "MJX-CONTAINER" &&
      node.getAttribute("display") === "true")
  );
}
