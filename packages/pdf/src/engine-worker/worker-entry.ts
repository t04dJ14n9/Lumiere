/**
 * The engine worker's script: the viewer bundles it into a string and starts
 * it as a blob worker (scripts/engine-worker.mjs). It stands where
 * `@embedpdf/engine/worker-entry` stands for an engine that is not Lumiere's.
 */
import { startEngineWorker } from "./worker-boot";

declare const self: DedicatedWorkerGlobalScope;

startEngineWorker(self);
