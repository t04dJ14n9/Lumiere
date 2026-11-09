import {
  extensionOf,
  folderOf,
  joinVaultPath,
  linkpathOfText,
  type LinkSyntax,
} from "../../shared/vault-path";
import { isInsideBundle } from "./paths";

export type OkfLinkAction =
  | { action: "passthrough" }
  | { action: "resolved"; path: string }
  | { action: "unresolved" };

export interface OkfLinkQuery {
  linktext: string;
  sourcePath: string;
  /** Set when the source note sits inside an OKF bundle. */
  bundleRoot: string | undefined;
  /**
   * The syntax that produced `linktext`. An extension is not a substitute:
   * Markdown `[x](metrics/topic)` is explicit, and `[[topic.md]]` is a wikilink.
   */
  syntax: LinkSyntax;
  /** Canonical vault path when that exact path exists. */
  find(path: string): string | undefined;
  /** The paths the vault's own rules accept for the link, best first. */
  candidates?(): readonly string[];
}

/**
 * Context-aware OKF resolution. Outside a bundle the vault's own rules apply
 * (`passthrough`). A wikilink follows them too, except that among the notes
 * they accept, the source's own bundle comes first: `[[topic]]` is the
 * bundle's topic, not a shorter same-name note elsewhere in the vault. A
 * leading `/` is bundle-root relative. Other Markdown paths, including `./`
 * and `../`, are source-file relative. A miss is unresolved and must not
 * basename-fallback.
 */
export function resolveOkfLink(query: OkfLinkQuery): OkfLinkAction {
  const { bundleRoot } = query;
  if (bundleRoot === undefined) {
    return { action: "passthrough" };
  }
  const path = linkpathOfText(query.linktext, query.syntax);
  if (path === "") {
    return { action: "passthrough" };
  }
  if (leavesToVault(path, query.syntax)) {
    return preferBundle(query.candidates?.() ?? [], bundleRoot);
  }
  const joined = explicitPath(path, query.sourcePath, bundleRoot);
  if (joined === undefined) {
    return { action: "unresolved" };
  }
  const found = locateFile(query.find, joined);
  return found ? { action: "resolved", path: found } : { action: "unresolved" };
}

/** The first candidate inside the bundle, when the vault would pick another. */
function preferBundle(
  candidates: readonly string[],
  bundleRoot: string,
): OkfLinkAction {
  const own = candidates.find((path) => isInsideBundle(path, bundleRoot));
  return own === undefined || own === candidates[0]
    ? { action: "passthrough" }
    : { action: "resolved", path: own };
}

function leavesToVault(path: string, syntax: LinkSyntax): boolean {
  if (path.startsWith("/") || path.startsWith("./") || path.startsWith("../")) {
    return false;
  }
  return syntax === "wikilink";
}

function explicitPath(
  path: string,
  sourcePath: string,
  bundleRoot: string,
): string | undefined {
  if (path.startsWith("/")) {
    return joinVaultPath(bundleRoot, path.slice(1));
  }
  return joinVaultPath(folderOf(sourcePath), path);
}

function locateFile(
  find: (path: string) => string | undefined,
  path: string,
): string | undefined {
  if (extensionOf(path)) {
    return find(path) ?? find(`${path}.md`);
  }
  return find(`${path}.md`) ?? find(path);
}
