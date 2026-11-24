import type { PdfBacklinkIndex } from "../../../../shared/pdf-backlink-index";
import type { PdfTextReader } from "../../../pdf-text/reader";
import type { PdfPanels } from "../../pdf/panels";
import type { AgentHandoff } from "../handoff";
import type { LastPdf } from "../last-pdf";
import type { NoteSelections } from "../note-selections";

/**
 * What the MCP tools read: the services the agent bridge plugin injected,
 * handed over as one object so a new tool needs no new parameter on the
 * path from the plugin to the server.
 */
export interface BridgeDeps {
  panels: PdfPanels;
  /** Plugin-owned tracker shared with the envelope command. */
  lastPdf: LastPdf;
  handoff: AgentHandoff;
  backlinks: PdfBacklinkIndex;
  /** PDF text from the host's own PDFium; owned (and disposed) by the plugin. */
  text: PdfTextReader;
  /** The Markdown editor's selections, when Lumiere runs. */
  notes?: NoteSelections;
}
