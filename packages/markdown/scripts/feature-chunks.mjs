// Which files the editor webview fetches for each feature plugin, from
// esbuild's metafile: the feature's own chunk plus the shared chunks it
// imports that the entry's static graph does not already carry. The extension
// host lists the first-view features' files as modulepreload hints.
import path from "node:path";
import { outputOfEntry, staticGraph } from "./static-graph.mjs";

const FEATURE_ENTRY = /^src\/plugins\/([^/]+)\/webview\.ts$/;

/**
 * `{ featureId: ["webview/<file>.js", ...] }`, paths relative to dist/ so the
 * host can hand them to its asset URL builder as they are. The metafile names
 * files relative to the build's working directory.
 */
export function featureChunks({ metafile, workingDirectory, distDirectory }) {
  const loadedWithEntry = staticGraph(
    metafile,
    outputOfEntry(metafile, "src/webview/main.ts"),
  );
  const chunks = {};
  for (const [key, output] of Object.entries(metafile.outputs)) {
    const id = FEATURE_ENTRY.exec(output.entryPoint ?? "")?.[1];
    if (id) {
      chunks[id] = [...staticGraph(metafile, key)]
        .filter((file) => !loadedWithEntry.has(file))
        .map((file) =>
          path.relative(distDirectory, path.resolve(workingDirectory, file)),
        )
        .map((file) => file.replaceAll("\\", "/"));
    }
  }
  return chunks;
}
