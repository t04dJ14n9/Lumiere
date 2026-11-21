/**
 * Where the test VS Code's window opens, shared by the Markdown
 * (test/vscode) and PDF (packages/pdf/test/vscode) harnesses.
 *
 * On Linux it gets a display of its own, 1920 by 1080, whatever display the
 * suite was started on: the specs measure layouts a small screen changes,
 * and `xvfb-run`'s default screen is 640 by 480 (a note's line wraps, a
 * picker shows five rows, the Settings editor drops to its narrow layout).
 * A private display also keeps the test window off the owner's desktop.
 * LUMIERE_VSCODE_DISPLAY=inherit keeps the caller's display instead, to
 * watch the window; without Xvfb installed the caller's display is used.
 *
 * On a Mac with several screens, `placeWindowOnBuiltInScreen` opens the test
 * window maximized on the built-in screen instead of the one under the pointer.
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

/** A rectangle in Electron's screen coordinates: points, y down from the top of the primary screen. */
export interface WorkArea {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A screen as AppKit reports it: its visible frame, y up from the primary screen's bottom edge. */
export interface MacScreen extends WorkArea {
  readonly isBuiltIn: boolean;
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
  const read = readMacScreens();
  const area = read && builtInWorkArea(read.screens, read.primaryHeight);
  if (!area) {
    return;
  }
  const globalStorage = path.join(userData, "User", "globalStorage");
  mkdirSync(globalStorage, { recursive: true });
  writeFileSync(
    path.join(globalStorage, "storage.json"),
    JSON.stringify(windowStateOn(area)),
  );
}

/**
 * The built-in screen's work area in Electron's coordinates, when there are
 * other screens too. AppKit measures y up from the primary screen's bottom
 * edge; Electron measures it down from that screen's top edge.
 */
export function builtInWorkArea(
  screens: readonly MacScreen[],
  primaryHeight: number,
): WorkArea | undefined {
  const builtIn = screens.find((screen) => screen.isBuiltIn);
  if (screens.length < 2 || builtIn === undefined) {
    return undefined;
  }
  return {
    x: builtIn.x,
    y: primaryHeight - (builtIn.y + builtIn.height),
    width: builtIn.width,
    height: builtIn.height,
  };
}

/**
 * VS Code's saved window state (`windowsState` in globalStorage's
 * storage.json, read by its windowsStateHandler) that opens its first window
 * maximized (mode 0) on `area`.
 */
export function windowStateOn(area: WorkArea): unknown {
  return {
    windowsState: {
      lastActiveWindow: { uiState: { mode: 0, ...area } },
      openedWindows: [],
    },
  };
}

/**
 * The screens AppKit knows and the primary screen's height. Built-in is
 * CoreGraphics' answer, not the screen's name, which follows the system
 * language.
 */
function readMacScreens():
  { screens: MacScreen[]; primaryHeight: number } | undefined {
  const script = `
    ObjC.import("AppKit");
    ObjC.import("CoreGraphics");
    const all = $.NSScreen.screens;
    const screens = [];
    for (let i = 0; i < all.count; i++) {
      const screen = all.objectAtIndex(i);
      const id = ObjC.unwrap(screen.deviceDescription.objectForKey("NSScreenNumber"));
      const area = screen.visibleFrame;
      screens.push({
        isBuiltIn: !!$.CGDisplayIsBuiltin(id),
        x: area.origin.x,
        y: area.origin.y,
        width: area.size.width,
        height: area.size.height,
      });
    }
    JSON.stringify({ screens, primaryHeight: all.objectAtIndex(0).frame.size.height });`;
  try {
    return JSON.parse(
      execFileSync("osascript", ["-l", "JavaScript", "-e", script], {
        encoding: "utf8",
      }),
    ) as { screens: MacScreen[]; primaryHeight: number };
  } catch {
    return undefined;
  }
}
