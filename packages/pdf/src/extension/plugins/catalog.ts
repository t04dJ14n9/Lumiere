/**
 * Every PDF plugin. Each starts once the services it injects exist (see
 * @workshop/core), so this order only decides event and command precedence.
 *
 *   pdf          the viewer: custom editor, open editors, page/zoom/find, Open Location
 *   pdfBacklinks derived vault index of Markdown PDF deep links → viewer overlays
 *   pdfAnnotations conflict Reload/Keep mine and Retry for direct-to-PDF annotations
 *   pdfToolbar   where the controls are: status bar entries, the mode setting
 *   pdfOutline   the PDF Outline view in the Explorer
 *   pdfBookmarks the reader's own bookmarks: Add and Go to Bookmark, the PDF Bookmarks view
 *   pdfLookUp    macOS Look Up: a force click or the context menu opens the Dictionary
 *   pdfSettings  PDF: Open Settings and the commands that change the common settings
 *   pdfZen       zen mode: core Zen Mode, and a floating bar with Exit zen in the viewer
 *   pdfRegions   PNG snapshots of selected regions, for agents
 *   agentBridge  Copy Link for Agent, the selection envelope command, the AgentHandoff service, the opt-in MCP server
 *   ideContext   Copy/Send IDE Context (clipboard-first; never silent-guess)
 */
import { agentBridgePlugin } from "./agentBridge/plugin";
import { ideContextPlugin } from "./ideContext/plugin";
import { pdfAnnotationsPlugin } from "./pdfAnnotations/plugin";
import { pdfPlugin } from "./pdf/plugin";
import { pdfBacklinksPlugin } from "./pdfBacklinks/plugin";
import { pdfBookmarksPlugin } from "./pdfBookmarks/plugin";
import { pdfLookUpPlugin } from "./pdfLookUp/plugin";
import { pdfSettingsPlugin } from "./pdfSettings/plugin";
import { pdfOutlinePlugin } from "./pdfOutline/plugin";
import { pdfRegionsPlugin } from "./pdfRegions/plugin";
import { pdfToolbarPlugin } from "./pdfToolbar/plugin";
import { pdfZenPlugin } from "./pdfZen/plugin";
import { pdfHistoryPlugin } from "./pdfHistory/plugin";
import type { Plugin } from "@workshop/core";

export const plugins: readonly Plugin[] = [
  pdfPlugin,
  pdfBacklinksPlugin,
  pdfAnnotationsPlugin,
  pdfHistoryPlugin,
  pdfToolbarPlugin,
  pdfOutlinePlugin,
  pdfBookmarksPlugin,
  pdfRegionsPlugin,
  pdfLookUpPlugin,
  pdfZenPlugin,
  pdfSettingsPlugin,
  agentBridgePlugin,
  ideContextPlugin,
];
