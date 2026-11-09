// esbuild bundles stylesheet imports for their side effects.
declare module "*.css" {}

// The engine worker's script as a string (scripts/engine-worker.mjs).
declare module "lumiere:engine-worker" {
  const source: string;
  export default source;
}
