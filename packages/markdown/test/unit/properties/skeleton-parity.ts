import { headerParts } from "../../../src/markdown/properties/header-parts";
import {
  skeletonMarkup,
  skeletonSheet,
} from "../../../src/markdown/properties/frontmatter-skeleton";
import { renderProperties } from "../../../src/plugins/properties/sheet-html";

/** What the sheet or its skeleton shows in one row, read from its markup. */
export interface RowShape {
  key: string;
  /** The `data-property-type` the sheet gives the value (`multitext` is a list). */
  type: string;
  /** Text, link label, date or number shown; a checkbox's state. */
  shown: string;
  chips: string[];
}

const strip = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&")
    .trim();

function valueShown(value: string): string {
  const input =
    /<input[^>]*type="(number|date|datetime-local)"[^>]*value="([^"]*)"/.exec(
      value,
    );
  if (input) {
    return input[2]!;
  }
  if (/type="checkbox"/.test(value)) {
    return /\bchecked\b/.test(value) ? "checked" : "unchecked";
  }
  // A link shows its label; the sheet keeps the source in a hidden editor beside it.
  const link =
    /<span class="metadata-link"[^>]*>([\s\S]*?)<(?:button|\/span>)/.exec(
      value,
    );
  if (link) {
    return strip(link[1]!);
  }
  const text = /<div[^>]*metadata-input-longtext[^>]*>([\s\S]*?)<\/div>/.exec(
    value,
  );
  return text ? strip(text[1]!) : "";
}

/** The rows of a sheet's markup, in order. */
export function rowShapes(markup: string): RowShape[] {
  return markup
    .split('<div class="property-row')
    .slice(1)
    .map((row) => {
      const key =
        /class="property-key[^"]*"[^>]*?(?:value="([^"]*)"|>([^<]*)<)/.exec(
          row,
        );
      const type =
        /<div class="metadata-property-value"(?: data-property-type="([^"]*)")?/.exec(
          row,
        );
      const chips = [
        ...row.matchAll(
          /<span class="multi-select-pill-content">([\s\S]*?)<\/span><(?:button|span) [^>]*?(?:remove)/g,
        ),
      ].map((chip) => strip(chip[1]!));
      return {
        key: strip(key?.[1] ?? key?.[2] ?? ""),
        type: type?.[1] ?? "",
        shown: valueShown(row.slice(row.indexOf("metadata-property-value"))),
        chips,
      };
    });
}

/** The skeleton's rows' types, as the sheet names them. */
function skeletonTypes(source: string): string[] {
  const header = headerParts(source);
  return skeletonSheet(header?.body ?? "").rows.map((row) => {
    const { value } = row;
    switch (value.type) {
      case "list":
        return value.kind === "list" ? "multitext" : value.kind;
      case "link":
      case "opaque":
        return "text";
      default:
        return value.type;
    }
  });
}

/**
 * Where the skeleton says it is exact, the differences between its rows and
 * the sheet's: key, control, what is shown and each chip. Empty when they
 * agree (and when the skeleton does not claim to be exact).
 */
export function skeletonDifferences(source: string): string[] {
  const header = headerParts(source);
  if (!header) {
    return [];
  }
  const sheet = skeletonSheet(header.body);
  if (!sheet.isExact) {
    return [];
  }
  const real = rowShapes(renderProperties(source));
  const skeleton = rowShapes(skeletonMarkup(sheet));
  const types = skeletonTypes(source);
  const problems: string[] = [];
  if (real.length !== skeleton.length) {
    return [
      `${real.length} rows in the sheet, ${skeleton.length} in the skeleton`,
    ];
  }
  real.forEach((row, index) => {
    const mine = skeleton[index]!;
    const same = (what: string, a: unknown, b: unknown) => {
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        problems.push(
          `${row.key}: ${what} ${JSON.stringify(a)} in the sheet, ${JSON.stringify(b)} in the skeleton`,
        );
      }
    };
    same("key", row.key, mine.key);
    same("control", row.type, types[index]);
    same("shown", row.shown, mine.shown);
    same("chips", row.chips, mine.chips);
  });
  return problems;
}
