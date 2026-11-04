import { defineManifest } from "../manifest";

/**
 * Owns empty-page / Select Region selection and `lumiere.pdf.regions.enabled`
 * (default off). When off: no empty-page marquee, Select Region hidden, Copy
 * link never emits viewrect=. Snapshot storage stays available if a region
 * arrives while the setting is on.
 */
export default defineManifest({
  id: "pdfRegions",
  title: "Region Snapshots",
  capabilities: ["storage"],
});
