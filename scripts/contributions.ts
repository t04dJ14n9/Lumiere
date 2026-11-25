/**
 * Writes (or with --check, verifies) the extension's `contributes` in
 * package.json: Lumiere's, generated from its plugin manifests,
 * followed by Lumiere PDF's, kept in packages/pdf/contributes.json.
 * Each product keeps its own settings section.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { contributions as markdownContributions } from "../packages/markdown/scripts/contributions";
import { externalize } from "./manifest-nls";

type Contributes = Record<string, unknown>;

const manifestFile = new URL("../package.json", import.meta.url);
const pdfFile = new URL("../packages/pdf/contributes.json", import.meta.url);
const nlsFile = new URL("../package.nls.json", import.meta.url);

/** Lists concatenate; menus and views concatenate per location; settings stay separate sections. */
export function mergeContributions(...products: Contributes[]): Contributes {
  const merged: Contributes = {};
  for (const product of products) {
    for (const [key, value] of Object.entries(product)) {
      merged[key] = mergeEntry(key, merged[key], value);
    }
  }
  return merged;
}

function mergeEntry(key: string, current: unknown, next: unknown): unknown {
  if (current === undefined) {
    return key === "configuration" ? [next] : next;
  }
  if (key === "configuration") {
    return [...(current as unknown[]), next];
  }
  if (Array.isArray(current)) {
    return [...current, ...(next as unknown[])];
  }
  const locations = { ...(current as Record<string, unknown[]>) };
  for (const [location, entries] of Object.entries(
    next as Record<string, unknown[]>,
  )) {
    locations[location] = [...(locations[location] ?? []), ...entries];
  }
  return locations;
}

async function main(): Promise<void> {
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  const { contributes, nls } = externalize(
    mergeContributions(
      await markdownContributions(),
      JSON.parse(readFileSync(pdfFile, "utf8")) as Contributes,
    ),
  );
  const nlsText = JSON.stringify(nls, null, 2) + "\n";
  if (process.argv.includes("--check")) {
    const stale =
      JSON.stringify(manifest.contributes) !== JSON.stringify(contributes) ||
      readFileSync(nlsFile, "utf8") !== nlsText;
    if (stale) {
      throw new Error(
        "package.json contributes or package.nls.json are stale: run pnpm contributions",
      );
    }
    return;
  }
  manifest.contributes = contributes;
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(nlsFile, nlsText);
}

if (process.argv[1]?.endsWith("contributions.ts")) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
