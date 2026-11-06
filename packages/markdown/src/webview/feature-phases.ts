import type { FeaturePhase } from "./features";

export interface FeaturePhaseRun {
  /** Resolves when the chrome features' modules (Properties, line numbers) are imported. */
  chromeChunks: Promise<void>;
  /** Starts importing the rest of the first view's modules. */
  startPaint(): Promise<void>;
  configure(phase: FeaturePhase): Promise<unknown>;
  mark(name: string): void;
  /**
   * The page lists the first view's chunks as modulepreload hints, so both
   * sets of modules are fetched while the entry loads and waiting for the
   * second costs next to nothing.
   */
  preloaded: boolean;
}

/**
 * Turns the features on in the order the first view needs them: chrome
 * (Properties sheet, line-number gutter), the rest of the first screen's
 * structure, then everything else.
 *
 * Chrome is configured alone when the modules arrive late, so the sheet never
 * waits for the download of tables or callouts (#288). With the modules
 * already preloaded there is nothing to wait for, and one configure for both
 * saves a reconfigure (a note with 100 properties has its features ~40 ms
 * sooner).
 */
export async function runFeaturePhases(run: FeaturePhaseRun): Promise<void> {
  const paintChunks = run.startPaint();
  if (run.preloaded) {
    await Promise.all([run.chromeChunks, paintChunks]);
    // The paint phase includes the chrome features.
    await run.configure("paint");
    run.mark("mw:properties");
  } else {
    await run.chromeChunks;
    await run.configure("chrome");
    run.mark("mw:properties");
    await paintChunks;
    await run.configure("paint");
  }
  run.mark("mw:features");
  await run.configure("all");
}
