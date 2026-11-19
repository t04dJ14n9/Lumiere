/** See bundle-checks.mjs. */
export function keepsBasenameCreate(extensionJs: string): boolean;
/** See bundle-checks.mjs. */
export const gatedBundleRows: readonly string[];
export interface BundleRowGrowth {
  name: string;
  before: number;
  now: number;
}
/** See bundle-checks.mjs. */
export function bundleGrowth(
  current: Record<string, number>,
  baseline: Record<string, number>,
  tolerance: number,
): { failures: BundleRowGrowth[]; warnings: BundleRowGrowth[] };
