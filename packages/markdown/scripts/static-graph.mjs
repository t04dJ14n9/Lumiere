// The files esbuild's output loads together, from its metafile: an output
// file and the output files it imports with a static `import`. A dynamic
// import() is not followed: it starts another graph.
export function staticGraph(metafile, key, seen = new Set()) {
  if (!seen.has(key)) {
    seen.add(key);
    for (const edge of metafile.outputs[key].imports) {
      if (edge.kind === "import-statement" && metafile.outputs[edge.path]) {
        staticGraph(metafile, edge.path, seen);
      }
    }
  }
  return seen;
}

/** The output file whose entry point is `entryPoint`, as the metafile names it. */
export function outputOfEntry(metafile, entryPoint) {
  const key = Object.keys(metafile.outputs).find(
    (candidate) => metafile.outputs[candidate].entryPoint === entryPoint,
  );
  if (!key) {
    throw new Error(`no output for entry point ${entryPoint}`);
  }
  return key;
}
