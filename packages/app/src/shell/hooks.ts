/** The shell's state hooks: theme, vaults and files, server events, menu. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FileEntry, ServerEvent, VaultFiles } from "./api";
import { backend } from "./backend";
import { sameListing } from "./tree";
import { openShownPageMenu } from "./components/EditorFrame";
import { onMenuCommand, type MenuCommand } from "./tauri";
import { applyShellTheme, onThemeChange } from "./theme";

export function useShellTheme(): void {
  useEffect(() => {
    applyShellTheme();
    return onThemeChange(applyShellTheme);
  }, []);
}

export interface Errors {
  readonly message: string | undefined;
  /** Show the error if `work` fails; the shell's sink for work it does not await. */
  report(work: Promise<unknown>): void;
  dismiss(): void;
}

export function useErrors(): Errors {
  const [message, setMessage] = useState<string>();
  const report = useCallback((work: Promise<unknown>) => {
    work.catch((error: unknown) =>
      setMessage(error instanceof Error ? error.message : String(error)),
    );
  }, []);
  const dismiss = useCallback(() => setMessage(undefined), []);
  return useMemo(
    () => ({ message, report, dismiss }),
    [message, report, dismiss],
  );
}

export interface VaultState {
  readonly open: readonly string[];
  readonly recent: readonly string[];
  readonly current: string | undefined;
  readonly files: readonly FileEntry[];
  /** The vault holds more files than are listed. */
  readonly partial: boolean;
  select(vault: string): void;
  /** Read the vault list again (a vault opened or closed). */
  reload(): Promise<void>;
  /** List the current vault's files again (they changed on disk). */
  refreshFiles(): void;
}

export function useVaults(report: Errors["report"]): VaultState {
  const [open, setOpen] = useState<readonly string[]>([]);
  const [recent, setRecent] = useState<readonly string[]>([]);
  const [current, setCurrent] = useState<string>();
  const [listing, setListing] = useState<VaultFiles>(EMPTY_LISTING);
  const [generation, setGeneration] = useState(0);

  const reload = useCallback(async () => {
    const list = await backend().vaults.list();
    setOpen(list.open);
    setRecent(list.recent);
    setCurrent((shown) =>
      shown && list.open.includes(shown) ? shown : list.open.at(-1),
    );
  }, []);
  useEffect(() => report(reload()), [reload, report]);
  useEffect(() => {
    if (!current) {
      setListing(EMPTY_LISTING);
      return;
    }
    let live = true;
    report(
      backend()
        .vaults.files(current)
        .then(
          (listed) =>
            // An unchanged listing (most focus changes) keeps the tree as it is.
            live &&
            setListing((shown) =>
              sameListing(shown, listed) ? shown : listed,
            ),
        ),
    );
    return () => {
      live = false;
    };
  }, [current, generation, report]);
  // Files created outside the app appear when the window comes back.
  useEffect(() => {
    const refresh = () => setGeneration((value) => value + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  const refreshFiles = useCallback(
    () => setGeneration((value) => value + 1),
    [],
  );
  return useMemo(
    () => ({
      open,
      recent,
      current,
      files: listing.files,
      partial: listing.partial,
      select: setCurrent,
      reload,
      refreshFiles,
    }),
    [open, recent, current, listing, reload, refreshFiles],
  );
}

const EMPTY_LISTING: VaultFiles = { files: [], partial: false };

/** One event stream for the window; the listeners may change between renders. */
export function useServerEvents(
  ...listeners: readonly ((event: ServerEvent) => void)[]
): void {
  const latest = useRef(listeners);
  latest.current = listeners;
  useEffect(
    () =>
      backend().events((event) =>
        latest.current.forEach((listener) => listener(event)),
      ),
    [],
  );
}

export function useMenuCommands(
  handlers: Readonly<Record<MenuCommand, () => void>>,
): void {
  const latest = useRef(handlers);
  latest.current = handlers;
  useEffect(() => onMenuCommand((command) => latest.current[command]()), []);
  useEffect(
    () =>
      backend().appCommands?.((command) => {
        if (command === "page-menu") {
          openShownPageMenu();
        } else {
          latest.current[command]();
        }
      }),
    [],
  );
}
