/** What an MCP tool answers: text (and for a region, its snapshot), or an error the agent can read. */
export type Content =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface ToolResult {
  [key: string]: unknown;
  content: Content[];
  isError?: boolean;
}

/** A refusal or failure whose message goes to the agent as it is. */
export class ToolError extends Error {}

export function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

export function jsonResult(value: unknown): ToolResult {
  return textResult(JSON.stringify(value));
}

/**
 * Run a tool: a `ToolError` becomes an MCP error result (`isError`), which
 * the agent reads and can act on; anything else is a bug and propagates.
 */
export async function guarded(
  run: () => Promise<ToolResult>,
): Promise<ToolResult> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ToolError) {
      return {
        content: [{ type: "text", text: error.message }],
        isError: true,
      };
    }
    throw error;
  }
}

/** `text` cut to `max` characters, with an ellipsis when it was longer. */
export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
