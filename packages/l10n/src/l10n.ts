/**
 * Lumiere's translated text. Every user-facing string goes through `t`, with
 * the English text as its key, as VS Code's own `l10n.t` does: with no
 * bundle (English, or a language Lumiere has no translation for) the text
 * is the English one, and a bundle maps it to the reader's language.
 *
 * The language is VS Code's display language (`vscode.env.language`): the
 * extension host configures this module with `vscode.l10n.bundle`, and hands
 * the same bundle to each webview page (`l10nMeta`, `readL10n`). The module
 * imports nothing from `vscode`, so shared code may use it in the host, a
 * webview, or a worker alike.
 *
 * Messages are whole sentences with `{0}`, `{1}` placeholders, never
 * concatenated pieces, and `t` is called where the text is shown (not in a
 * module-level table, which runs before a webview has its bundle).
 * `scripts/l10n.ts` collects every `t("…")` key and checks each language's
 * bundle has them all.
 */

/** A bundle as VS Code loads it: the English text to its translation. */
export type L10nBundle = Readonly<
  Record<string, string | { message: string; comment?: readonly string[] }>
>;

/** A placeholder's value. */
export type L10nArg = string | number | boolean;

let current: L10nBundle | undefined;
let currentLanguage = "en";

/** Sets the bundle `t` reads from; undefined for English. */
export function configureL10n(
  bundle: L10nBundle | undefined,
  language = "en",
): void {
  current = bundle && Object.keys(bundle).length > 0 ? bundle : undefined;
  currentLanguage = language;
}

/** The display language the bundle is for, as VS Code names it (`en`, `zh-cn`). */
export function l10nLanguage(): string {
  return currentLanguage;
}

/** The bundle in use, to hand to a webview; undefined for English. */
export function l10nBundle(): L10nBundle | undefined {
  return current;
}

/**
 * `message` in the reader's language, with `{0}`, `{1}` … replaced by
 * `args`. A placeholder with no argument stays as written.
 */
export function t(message: string, ...args: L10nArg[]): string {
  const entry = current?.[message];
  const text = typeof entry === "object" ? entry.message : (entry ?? message);
  if (args.length === 0) {
    return text;
  }
  return text.replace(/\{(\d+)\}/gu, (whole, index: string) => {
    const value = args[Number(index)];
    return value === undefined ? whole : String(value);
  });
}

/** The name of the page's `<meta>` element that carries the bundle. */
const META_NAME = "lumiere-l10n";

function escapeAttribute(text: string): string {
  return text
    .replace(/&/gu, "&amp;")
    .replace(/"/gu, "&quot;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;");
}

/**
 * The bundle as a `<meta>` element for a webview page's head: data, not a
 * script, so the page's script policy and nonces are untouched.
 */
export function l10nMeta(): string {
  const payload = JSON.stringify({
    language: currentLanguage,
    bundle: current ?? {},
  });
  return `<meta name="${META_NAME}" content="${escapeAttribute(payload)}">`;
}

/** The part of a page's document `readL10n` reads (this package has no DOM types). */
interface PageDocument {
  querySelector(
    selector: string,
  ): { getAttribute(name: string): string | null } | null;
}

/** In a webview: configures `t` from the bundle its page carries. */
export function readL10n(document: PageDocument): void {
  const text = document
    .querySelector(`meta[name="${META_NAME}"]`)
    ?.getAttribute("content");
  if (!text) {
    return;
  }
  try {
    const { language, bundle } = JSON.parse(text) as {
      language?: string;
      bundle?: L10nBundle;
    };
    configureL10n(bundle, language);
  } catch {
    // A page without a valid bundle stays in English.
  }
}
