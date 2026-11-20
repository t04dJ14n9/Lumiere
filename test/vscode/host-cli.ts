import path from "node:path";

/**
 * The command-line launcher of a VS Code build. VS Code ships `bin/code`;
 * Cursor ships `bin/cursor` (its product's application name), so the
 * application name is tried first and `code` is the fallback.
 */
export function hostCli(options: {
  app: string;
  resources: string;
  platform: NodeJS.Platform;
  applicationName?: string;
  exists(file: string): boolean;
}): string {
  const { app, resources, platform, exists } = options;
  // Join for the platform asked about, not the one running: the unit test
  // asks for Linux and macOS paths on Windows too.
  const join = platform === "win32" ? path.win32.join : path.posix.join;
  const names = [...new Set([options.applicationName ?? "code", "code"])];
  const candidates = names.map((name) => {
    if (platform === "darwin") {
      return join(resources, "bin", name);
    }
    return join(app, "bin", platform === "win32" ? `${name}.cmd` : name);
  });
  return candidates.find(exists) ?? candidates.at(-1)!;
}
