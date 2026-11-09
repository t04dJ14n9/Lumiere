import { toPageRef } from "@embedpdf/core";
import { createTestContext } from "@embedpdf/core/testing";
import { stagePlugin, type StageConfig } from "@embedpdf/plugin-stage";
import type { StageHostCapability } from "@embedpdf/plugin-stage/contract/host";

/**
 * EmbedPDF's real Stage over `count` pages of 600 x 800 points, laid out in a
 * 900 x 700 viewer as the viewer registers it (one view unit per point,
 * padding and gap of 12). Its motion has no frames to run on, so a smooth
 * move lands at once.
 */
export function realStage(
  options: {
    count?: number;
    config?: StageConfig;
    width?: number;
    /** Leave it without a size, as it is before the viewer reports one. */
    unsized?: boolean;
  } = {},
): StageHostCapability {
  const plugin = stagePlugin({
    viewUnitsPerPoint: 1,
    padding: 12,
    gap: 12,
    responsive: [],
    minZoom: 0.25,
    maxZoom: 4,
    zoom: { mode: "fit-width" },
    ...options.config,
  });
  const state = plugin.state?.();
  if (!state) {
    throw new Error("the Stage plugin has state");
  }
  const context = createTestContext({
    id: "stage",
    state,
    pages: Array.from({ length: options.count ?? 6 }, (_, index) => ({
      ref: toPageRef(index + 1),
      size: { width: 600, height: 800 },
    })),
  });
  const stage = context.connect(
    plugin.create(context),
  ) as unknown as StageHostCapability;
  if (!options.unsized) {
    stage.setViewportSize({ width: options.width ?? 900, height: 700 });
  }
  return stage;
}
