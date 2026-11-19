/**
 * The system's trash, where the server's machine has one it can reach
 * without asking: macOS's `trash` (macOS 15 and later), GLib's `gio trash`
 * on Linux, and the Recycle Bin through PowerShell on Windows. The file tree
 * deletes there first; where none answers, the window asks before
 * deleting for good (files-api.ts).
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";

export interface TrashCommand {
  readonly command: string;
  readonly args: readonly string[];
  /** Added to the environment: the path reaches PowerShell as a variable, never as code. */
  readonly env?: Readonly<Record<string, string>>;
}

const MACOS_TRASH = "/usr/bin/trash";

/** PowerShell's Recycle Bin, for the file or folder named by `LUMIERE_TRASH`. */
const RECYCLE = [
  "Add-Type -AssemblyName Microsoft.VisualBasic;",
  "$p = $env:LUMIERE_TRASH;",
  "if (Test-Path -LiteralPath $p -PathType Container) {",
  "[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, 'OnlyErrorDialogs', 'SendToRecycleBin')",
  "} else {",
  "[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin')",
  "}",
].join(" ");

/** How to put `file` (an absolute path) in the trash here; undefined where there is none. */
export function trashCommand(
  platform: NodeJS.Platform,
  file: string,
  exists: (program: string) => boolean = existsSync,
): TrashCommand | undefined {
  switch (platform) {
    case "darwin":
      // It takes no "--"; the path is absolute, so it is never an option.
      return exists(MACOS_TRASH)
        ? { command: MACOS_TRASH, args: [file] }
        : undefined;
    case "linux":
      return { command: "gio", args: ["trash", "--", file] };
    case "win32":
      return {
        command: "powershell.exe",
        args: ["-NoProfile", "-NonInteractive", "-Command", RECYCLE],
        env: { LUMIERE_TRASH: file },
      };
    default:
      return undefined;
  }
}

export type RunCommand = (command: TrashCommand) => Promise<void>;

/**
 * Put a file or folder in the trash; false when there is no trash here or
 * it refused (no `gio`, a disk without one), and nothing was deleted.
 */
export function createTrash(
  run: RunCommand = runCommand,
  platform: NodeJS.Platform = process.platform,
): (file: string) => Promise<boolean> {
  return async (file) => {
    const command = trashCommand(platform, file);
    if (!command) {
      return false;
    }
    try {
      await run(command);
    } catch {
      return false;
    }
    // A trash that answered without moving the file did not trash it.
    return !existsSync(file);
  };
}

function runCommand({ command, args, env }: TrashCommand): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      {
        timeout: 30_000,
        windowsHide: true,
        ...(env ? { env: { ...process.env, ...env } } : {}),
      },
      (error) => (error ? reject(error) : resolve()),
    );
  });
}
