/**
 * What the agent bridge spec needs to act as an MCP client: the stdio shim
 * Claude Code, Codex and Cursor run (newline-delimited JSON-RPC over its
 * standard input and output), and plain HTTP requests to the bridge itself.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import http from "node:http";

interface JsonRpcResponse {
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

/** A tool call's answer: its text parts joined, and whether the tool refused. */
export interface ToolResult {
  isError: boolean;
  text: string;
}

/** The shim as a child process, spoken to as an MCP client would. */
export class StdioShim {
  private readonly child: ChildProcessWithoutNullStreams;
  private buffer = "";
  private nextId = 1;
  private readonly pending = new Map<
    number,
    (response: JsonRpcResponse) => void
  >();
  private stderr = "";

  /** Runs `shim` with the test's own Node, so no editor is involved. */
  constructor(
    shim: string,
    options: { cwd: string; env: Record<string, string> },
  ) {
    this.child = spawn(process.execPath, [shim], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
    });
    this.child.stdout.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString();
      this.drain();
    });
    this.child.stderr.on("data", (chunk: Buffer) => {
      this.stderr += chunk.toString();
    });
  }

  /** The shim's standard error: where an MCP client shows the server's log. */
  get errorOutput(): string {
    return this.stderr;
  }

  private drain(): void {
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) {
        return;
      }
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) {
        const response = JSON.parse(line) as JsonRpcResponse;
        this.pending.get(response.id)?.(response);
      }
    }
  }

  request(method: string, params: unknown = {}): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error(`No answer to ${method}; shim stderr: ${this.stderr}`),
          ),
        30_000,
      );
      this.pending.set(id, (response) => {
        clearTimeout(timer);
        resolve(response);
      });
      this.child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
      );
    });
  }

  notify(method: string): void {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
  }

  /** The `result` of a request, which must not be a JSON-RPC error. */
  async result<T>(method: string, params: unknown = {}): Promise<T> {
    const response = await this.request(method, params);
    if (response.error) {
      throw new Error(`${method}: ${response.error.message}`);
    }
    return response.result as T;
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const result = await this.result<{
      content: { type: string; text?: string }[];
      isError?: boolean;
    }>("tools/call", { name, arguments: args });
    return {
      isError: result.isError === true,
      text: result.content
        .map((part) => part.text ?? "")
        .filter(Boolean)
        .join("\n"),
    };
  }

  /** Stop the shim and wait until it has gone. */
  async close(): Promise<void> {
    if (this.child.exitCode === null && this.child.signalCode === null) {
      this.child.kill("SIGTERM");
      await once(this.child, "exit");
    }
  }
}

/** One HTTP request to the bridge's loopback port, whatever its answer. */
export function bridgeRequest(
  endpoint: string,
  request: {
    path: string;
    headers: Record<string, string>;
    method?: string;
    body?: unknown;
  },
): Promise<{ status: number; body: string }> {
  const { port } = new URL(endpoint);
  return new Promise((resolve, reject) => {
    const outgoing = http.request(
      {
        host: "127.0.0.1",
        port,
        path: request.path,
        method: request.method ?? "POST",
        headers: request.headers,
      },
      (response) => {
        let body = "";
        response.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        response.on("end", () =>
          resolve({ status: response.statusCode ?? 0, body }),
        );
      },
    );
    outgoing.on("error", reject);
    if (request.body !== undefined) {
      outgoing.write(JSON.stringify(request.body));
    }
    outgoing.end();
  });
}
