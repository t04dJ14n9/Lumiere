/**
 * Lumiere's translations: verifies them (--check) or writes the files VS
 * Code loads for each language (the build runs it; the files are not
 * committed, so area PRs never conflict over them), from the translators'
 * files under l10n/<language>/:
 *
 * - l10n/<language>/manifest.json translates package.nls.json (the
 *   manifest's text, written by `pnpm contributions`) into
 *   package.nls.<language>.json.
 * - Every other l10n/<language>/*.json (one per area of the code) translates
 *   the `t("…")` messages of the source; together they make
 *   l10n/bundle.l10n.<language>.json.
 *
 * The check also requires each language to translate every message the
 * source has and no message it no longer has, with the same `{0}`
 * placeholders, and every `t` call to name its message as a literal.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const root = new URL("..", import.meta.url).pathname;
const SOURCES = ["src", "packages"];
const L10N_MODULE = /(?:^@workshop\/l10n|\/l10n\/src\/l10n)$/u;

type Texts = Record<string, string>;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!["node_modules", "dist", "test", "scripts"].includes(entry.name)) {
        out.push(...sourceFiles(path));
      }
    } else if (
      /\.tsx?$/u.test(entry.name) &&
      !/\.test\.tsx?$/u.test(entry.name)
    ) {
      out.push(path);
    }
  }
  return out;
}

/** The local names `t` is imported under in a file. */
function translatorNames(file: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of file.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      L10N_MODULE.test(statement.moduleSpecifier.text)
    ) {
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if ((element.propertyName ?? element.name).text === "t") {
            names.add(element.name.text);
          }
        }
      }
    }
  }
  return names;
}

/** Every message the source translates, and the calls that name none. */
export function collectMessages(files: readonly string[]): {
  messages: Map<string, string>;
  errors: string[];
} {
  const messages = new Map<string, string>();
  const errors: string[] = [];
  for (const path of files) {
    const text = readFileSync(path, "utf8");
    if (!text.includes("l10n")) {
      continue;
    }
    const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    const names = translatorNames(file);
    if (names.size === 0) {
      continue;
    }
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        names.has(node.expression.text)
      ) {
        const [first] = node.arguments;
        const where = `${relative(root, path)}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
        if (first && ts.isStringLiteralLike(first)) {
          messages.set(first.text, messages.get(first.text) ?? where);
        } else {
          errors.push(`${where}: t() needs its message as a literal string`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return { messages, errors };
}

/** The `{n}` placeholders of a message, in order of number. */
export function placeholders(text: string): string {
  return [...new Set(text.match(/\{\d+\}/gu) ?? [])].sort().join(",");
}

/**
 * Every difference between what a language translates and what it should:
 * `english` maps each key to its English text.
 */
export function compareTranslations(
  language: string,
  english: ReadonlyMap<string, string>,
  translated: Texts,
): string[] {
  const problems: string[] = [];
  for (const [key, text] of english) {
    const translation = translated[key];
    if (translation === undefined) {
      problems.push(`${language}: no translation for ${JSON.stringify(key)}`);
    } else if (placeholders(translation) !== placeholders(text)) {
      problems.push(
        `${language}: ${JSON.stringify(key)} has placeholders ${placeholders(translation) || "none"}, not ${placeholders(text) || "none"}`,
      );
    }
  }
  for (const key of Object.keys(translated)) {
    if (!english.has(key)) {
      problems.push(`${language}: ${JSON.stringify(key)} is no longer used`);
    }
  }
  return problems;
}

function readJson(path: string): Texts {
  return JSON.parse(readFileSync(path, "utf8")) as Texts;
}

/** A language's area files merged; two files may not disagree. */
function mergeAreas(dir: string, files: readonly string[]): Texts {
  const merged: Texts = {};
  for (const name of files) {
    for (const [key, text] of Object.entries(readJson(join(dir, name)))) {
      if (key in merged && merged[key] !== text) {
        throw new Error(
          `${dir}: ${JSON.stringify(key)} is translated twice, differently`,
        );
      }
      merged[key] = text;
    }
  }
  return merged;
}

function sorted(texts: Texts): string {
  const keys = Object.keys(texts).sort();
  return (
    JSON.stringify(
      Object.fromEntries(keys.map((key) => [key, texts[key]])),
      null,
      2,
    ) + "\n"
  );
}

interface Output {
  path: string;
  text: string;
}

/** The files one language makes, and what is wrong with its translation. */
function language(
  name: string,
  messages: ReadonlyMap<string, string>,
  manifest: ReadonlyMap<string, string>,
): { outputs: Output[]; problems: string[] } {
  const dir = join(root, "l10n", name);
  const files = readdirSync(dir).filter((file) => file.endsWith(".json"));
  const areas = mergeAreas(
    dir,
    files.filter((file) => file !== "manifest.json"),
  );
  const nls = files.includes("manifest.json")
    ? readJson(join(dir, "manifest.json"))
    : {};
  return {
    outputs: [
      {
        path: join(root, "l10n", `bundle.l10n.${name}.json`),
        text: sorted(areas),
      },
      { path: join(root, `package.nls.${name}.json`), text: sorted(nls) },
    ],
    problems: [
      ...compareTranslations(name, messages, areas),
      ...compareTranslations(`${name} manifest`, manifest, nls),
    ],
  };
}

function main(): void {
  const check = process.argv.includes("--check");
  const files = SOURCES.flatMap((dir) => sourceFiles(join(root, dir)));
  const { messages, errors } = collectMessages(files);
  const manifest = new Map(
    Object.entries(readJson(join(root, "package.nls.json"))),
  );
  const languages = readdirSync(join(root, "l10n"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const problems = [...errors];
  for (const name of languages) {
    // A source message is its own English text.
    const english = new Map([...messages.keys()].map((key) => [key, key]));
    const result = language(name, english, manifest);
    problems.push(...result.problems);
    if (!check) {
      for (const { path, text } of result.outputs) {
        writeFileSync(path, text);
      }
    }
  }
  if (problems.length > 0) {
    // Writing (the build) only warns: an untranslated message shows in
    // English. The check, part of `pnpm check`, fails.
    console.error(problems.join("\n"));
    process.exitCode = check ? 1 : 0;
  }
}

if (process.argv[1]?.endsWith("l10n.ts")) {
  main();
}
