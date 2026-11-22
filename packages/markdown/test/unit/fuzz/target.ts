/** A text function under fuzz: one text, or a before/after pair. */
export interface Target {
  readonly arity: 1 | 2;
  /**
   * Optional child-process deadline for this target (ms). Use when a target
   * does real work per case (e.g. full markdown-it render) so the whole
   * adversarial suite needs more than the default under CI load — without
   * relaxing the per-case CASE_MS linearity check for other targets.
   */
  readonly deadlineMs?: number;
  /**
   * Optional per-case budget (ms). Overrides the harness CASE_MS default for
   * this target only — for work that is still linear but slower under CI load.
   * Ignored when `scaling` is set.
   */
  readonly caseMs?: number;
  /**
   * Judge the target by how its time grows, not by how long it takes: a
   * wall-clock budget is a guess about the machine, and Windows CI runners
   * ran a full render of every case at 80k-110k characters from half to the
   * whole of a 45 s deadline. Every case runs at `small` and at `large`
   * characters (./inputs.ts), on the same machine, and fails when the large
   * run takes more than `maxRatio` times the small one.
   */
  readonly scaling?: Scaling;
  run(a: string, b: string): unknown;
}

export interface Scaling {
  /** Characters of the smaller and the larger run of every case. */
  readonly small: number;
  readonly large: number;
  /**
   * The most the larger run may take, as a multiple of the smaller. Linear
   * work takes `large / small`; a quadratic one takes its square.
   */
  readonly maxRatio: number;
  /** A smaller run is counted as at least this long (ms), so that timer and scheduler noise on a run of a few ms does not make a ratio. */
  readonly floorMs: number;
}

/** Whether the larger run grew faster than `scaling` allows. */
export function growsTooFast(
  scaling: Scaling,
  smallMs: number,
  largeMs: number,
): boolean {
  return largeMs > scaling.maxRatio * Math.max(smallMs, scaling.floorMs);
}
