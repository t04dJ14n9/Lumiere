/**
 * Fakes for the agent bridge's tools: panels, deps, and a real MCP client
 * over an in-memory transport, so a test sees what an agent would.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { BridgeDeps } from "../../../src/extension/plugins/agentBridge/mcp/deps";
import { createBridgeServer } from "../../../src/extension/plugins/agentBridge/mcp/tools";
import { LastPdf } from "../../../src/extension/plugins/agentBridge/last-pdf";
import type { AgentHandoff } from "../../../src/extension/plugins/agentBridge/handoff";
import { PdfBacklinkIndex } from "../../../src/shared/pdf-backlink-index";
import type { PdfPanels } from "../../../src/extension/plugins/pdf/panels";
import { fakeTextReader } from "./pdf-text-fake";

const noEvent = () => ({ dispose() {} });

/** The panels the tools read: `all` and `active`, and the events LastPdf listens to. */
export function fakePanels(all: unknown[] = [], active?: unknown): PdfPanels {
  return {
    all,
    active,
    onDidChange: noEvent,
    onDidOpen: noEvent,
  } as unknown as PdfPanels;
}

export function fakeDeps(extra: Partial<BridgeDeps> = {}): BridgeDeps {
  const panels = extra.panels ?? fakePanels();
  return {
    panels,
    lastPdf: new LastPdf(panels),
    handoff: {} as AgentHandoff,
    backlinks: new PdfBacklinkIndex(),
    // Knows no PDF: every one reads as missing.
    text: fakeTextReader().reader,
    ...extra,
  };
}

export interface ToolAnswer {
  /** The text blocks, joined. */
  text: string;
  isError: boolean;
  /** The first text block as JSON. */
  json(): unknown;
}

/** Run `use` with a client connected to a bridge server over `deps`. */
export async function withClient<T>(
  deps: BridgeDeps,
  use: (client: Client) => Promise<T>,
): Promise<T> {
  const server = createBridgeServer(deps);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  try {
    return await use(client);
  } finally {
    await client.close();
    await server.close();
  }
}

export function callTool(
  deps: BridgeDeps,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolAnswer> {
  return withClient(deps, async (client) => {
    const result = (await client.callTool({ name, arguments: args })) as {
      content: { type: string; text?: string }[];
      isError?: boolean;
    };
    const text = result.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    return {
      text,
      isError: result.isError === true,
      json: () => JSON.parse(result.content[0]!.text!) as unknown,
    };
  });
}
