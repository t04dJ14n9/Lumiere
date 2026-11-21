/**
 * The X display the test VS Code opens on, shared by the Markdown
 * (test/vscode) and PDF (packages/pdf/test/vscode) harnesses.
 *
 * On Linux it gets a display of its own, 1920 by 1080, whatever display the
 * suite was started on: the specs measure layouts a small screen changes,
 * and `xvfb-run`'s default screen is 640 by 480 (a note's line wraps, a
 * picker shows five rows, the Settings editor drops to its narrow layout).
 * A private display also keeps the test window off the owner's desktop.
 * LUMIERE_VSCODE_DISPLAY=inherit keeps the caller's display instead, to
 * watch the window; without Xvfb installed the caller's display is used.
 */
import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const SCREEN = "1920x1080x24";
const START_TIMEOUT_MS = 10_000;

/**
 * Start the private display; its process id goes to `pidFile` for
 * `stopPrivateDisplay`. Resolves the DISPLAY value, or undefined to keep
 * the caller's.
 */
export async function startPrivateDisplay(
  pidFile: string,
): Promise<string | undefined> {
  if (
    process.platform !== "linux" ||
    process.env.LUMIERE_VSCODE_DISPLAY === "inherit"
  ) {
    return undefined;
  }
  // -displayfd: Xvfb picks a free display number and writes it to fd 3 once
  // it accepts connections, so nothing races another display's lock file.
  const server = spawn(
    "Xvfb",
    ["-displayfd", "3", "-screen", "0", SCREEN, "-nolisten", "tcp"],
    { detached: true, stdio: ["ignore", "ignore", "ignore", "pipe"] },
  );
  const display = await new Promise<string | undefined>((resolve) => {
    let written = "";
    const timer = setTimeout(() => resolve(undefined), START_TIMEOUT_MS);
    server.once("error", () => {
      clearTimeout(timer);
      resolve(undefined);
    });
    server.stdio[3]!.on("data", (chunk: Buffer) => {
      written += chunk.toString();
      if (written.includes("\n")) {
        clearTimeout(timer);
        resolve(`:${written.trim()}`);
      }
    });
  });
  if (display === undefined) {
    if (server.pid !== undefined) {
      killQuietly(server.pid);
    }
    console.warn(
      "Xvfb could not start: the test VS Code opens on the caller's display.",
    );
    return undefined;
  }
  server.unref();
  (server.stdio[3] as NodeJS.ReadableStream & { unref?: () => void }).unref?.();
  writeFileSync(pidFile, String(server.pid));
  return display;
}

/** Stop the display `startPrivateDisplay` started, if it did. */
export function stopPrivateDisplay(pidFile: string): void {
  if (!existsSync(pidFile)) {
    return;
  }
  killQuietly(Number(readFileSync(pidFile, "utf8")));
  rmSync(pidFile, { force: true });
}

function killQuietly(pid: number): void {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Already gone.
  }
}

/**
 * On a Mac with more than one screen, VS Code opens a new window on the
 * screen under the pointer, which is often one the owner is working on. A
 * profile that remembers a last window opens its first window where that one
 * was instead, so seed the fresh test profile with a maximized window on the
 * built-in screen. Nothing changes without a built-in screen or with only
 * one screen. Call it after creating `userData` and before VS Code starts.
 */
export function placeWindowOnBuiltInScreen(userData: string): void {
  if (process.platform !== "darwin") {
    return;
  }
  const screen = builtInScreen();
  if (screen === undefined) {
    return;
  }
  const globalStorage = path.join(userData, "User", "globalStorage");
  mkdirSync(globalStorage, { recursive: true });
  // VS Code's window state (windowsStateHandler): mode 0 is maximized.
  writeFileSync(
    path.join(globalStorage, "storage.json"),
    JSON.stringify({
      windowsState: {
        lastActiveWindow: { uiState: { mode: 0, ...screen } },
        openedWindows: [],
      },
    }),
  );
}

/**
 * The built-in screen's work area in Electron's coordinates (top-left of the
 * primary screen, y down), when there are other screens too.
 */
function builtInScreen():
  { x: number; y: number; width: number; height: number } | undefined {
  // AppKit gives each screen's frame with y up from the primary screen's
  // bottom edge; Electron measures y down from its top edge.
  const script = `
    ObjC.import("AppKit");
    const screens = $.NSScreen.screens;
    const primary = screens.objectAtIndex(0).frame;
    let found = null;
    for (let i = 0; i < screens.count; i++) {
      const screen = screens.objectAtIndex(i);
      if (/built-in/i.test(ObjC.unwrap(screen.localizedName))) {
        const area = screen.visibleFrame;
        found = {
          x: area.origin.x,
          y: primary.size.height - (area.origin.y + area.size.height),
          width: area.size.width,
          height: area.size.height,
        };
      }
    }
    JSON.stringify(screens.count > 1 ? found : null);`;
  try {
    const output = execFileSync(
      "osascript",
      ["-l", "JavaScript", "-e", script],
      {
        encoding: "utf8",
      },
    );
    return (
      (JSON.parse(output) as ReturnType<typeof builtInScreen>) ?? undefined
    );
  } catch {
    return undefined;
  }
}
