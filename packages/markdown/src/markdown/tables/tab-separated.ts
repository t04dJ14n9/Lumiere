interface Field {
  value: string;
  /** Index of the tab or line break that ends the field, or the text length. */
  end: number;
}

/**
 * Spreadsheets quote a cell that holds a tab, a line break or a quote: the
 * field runs to the closing quote and `""` stands for one quote. A quote that
 * is not closed at a field boundary does not wrap the cell, so the text stays
 * as typed.
 */
function quotedField(text: string, start: number): Field | undefined {
  let value = "";
  for (let index = start + 1; index < text.length; index++) {
    const char = text[index]!;
    const next = text[index + 1];
    if (char !== '"') {
      value += char;
    } else if (next === '"') {
      value += char;
      index++;
    } else if (next === undefined || next === "\t" || next === "\n") {
      return { value, end: index + 1 };
    } else {
      return undefined;
    }
  }
  return undefined;
}

function plainField(text: string, start: number): Field {
  let end = start;
  while (end < text.length && text[end] !== "\t" && text[end] !== "\n") {
    end++;
  }
  return { value: text.slice(start, end), end };
}

/** Rows of cell values from tab-separated text, as spreadsheets copy it. */
export function splitTabSeparated(text: string): string[][] {
  const source = text.replace(/\r\n?/g, "\n").replace(/\n$/, "");
  const rows: string[][] = [[]];
  let start = 0;
  for (;;) {
    const field =
      (source[start] === '"' ? quotedField(source, start) : undefined) ??
      plainField(source, start);
    rows.at(-1)!.push(field.value);
    if (field.end >= source.length) {
      return rows;
    }
    if (source[field.end] === "\n") {
      rows.push([]);
    }
    start = field.end + 1;
  }
}
