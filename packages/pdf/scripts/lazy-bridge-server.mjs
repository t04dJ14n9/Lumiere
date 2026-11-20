import path from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, not URL.pathname: the pathname keeps a space or a non-ASCII
// character percent-encoded, so it would never equal a resolved path.
const bridgeServerEntry = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src/extension/plugins/agentBridge/mcp/server.ts",
);

/**
 * Keeps the agent bridge's MCP server out of the extension host bundle: the
 * controller's `import('./server')` becomes a require of the separately built
 * server (`output`, relative to the host bundle). The server carries the MCP
 * SDK and zod, which the host never loads unless the bridge is turned on.
 * The build fails when no import matched, rather than silently bundling the
 * server or losing the bridge.
 */
export function lazyBridgeServer(output) {
  return {
    name: "lazy-agent-bridge-server",
    setup(build) {
      let matched = false;
      build.onStart(() => {
        matched = false;
      });
      build.onResolve({ filter: /^\.\/server$/ }, (args) => {
        if (path.join(args.resolveDir, "server.ts") !== bridgeServerEntry) {
          return undefined;
        }
        matched = true;
        return { path: output, external: true };
      });
      build.onEnd((result) => {
        if (matched || result.errors.length > 0) {
          return undefined;
        }
        return {
          errors: [
            {
              text: `no import of the agent bridge's MCP server (${bridgeServerEntry}) was found; it must stay a separate file`,
            },
          ],
        };
      });
    },
  };
}
