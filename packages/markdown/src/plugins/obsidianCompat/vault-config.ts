import type { Disposer } from "@workshop/core";
import type { ConfigFile, ConfigFiles } from "./config-files";
import type { ObsidianOverrides } from "./api";
import { mapAppSettings } from "./app-settings";
import { mapTemplatesSettings } from "./core-plugin-settings";
import { TypesRegistry } from "./types-registry";

export interface VaultConfigOptions {
  files: ConfigFiles;
  changed(): void;
  warn(message: string, error: unknown): void;
}

/** The files that seed Lumiere settings, each mapped on its own. */
const SETTINGS_FILES: readonly {
  file: ConfigFile;
  map(value: unknown): ObsidianOverrides;
}[] = [
  { file: "app.json", map: mapAppSettings },
  { file: "templates.json", map: mapTemplatesSettings },
];

interface SettingsSnapshot {
  source: string | undefined;
  overrides: ObsidianOverrides;
  hasWarned: boolean;
}

/** A vault's watchers and last-good snapshots; no dependency on editor focus. */
export class VaultConfig {
  readonly types: TypesRegistry;
  overrides: ObsidianOverrides = Object.freeze({});
  private readonly snapshots = new Map<ConfigFile, SettingsSnapshot>();
  private settingsQueue = Promise.resolve();
  private readonly stops: Disposer[] = [];
  private isStopped = false;

  constructor(private readonly options: VaultConfigOptions) {
    this.types = new TypesRegistry({
      read: () => options.files.read("types.json"),
      write: (text, expected) => options.files.writeTypes(text, expected),
      changed: options.changed,
      warn: options.warn,
    });
  }

  async start(): Promise<void> {
    // Subscribe before reading so an edit during startup schedules a reload.
    this.stops.push(
      this.options.files.watch("types.json", () => {
        void this.types
          .refresh()
          .catch((error) =>
            this.options.warn(
              "Could not refresh Obsidian property types.",
              error,
            ),
          );
      }),
      ...SETTINGS_FILES.map((source) =>
        this.options.files.watch(source.file, () => {
          void this.refreshSettings(source);
        }),
      ),
    );
    await Promise.all([
      this.types.refresh(),
      ...SETTINGS_FILES.map((source) => this.refreshSettings(source)),
    ]);
  }

  async dispose(): Promise<void> {
    this.isStopped = true;
    for (const stop of this.stops.splice(0)) {
      await stop();
    }
    await this.types.dispose();
    await this.settingsQueue;
  }

  /** Never rejects: a watcher failure keeps the previous snapshot and logs once. */
  private refreshSettings(
    settings: (typeof SETTINGS_FILES)[number],
  ): Promise<void> {
    this.settingsQueue = this.settingsQueue.then(async () => {
      if (this.isStopped) {
        return;
      }
      const snapshot = this.snapshot(settings.file);
      try {
        const source = await this.options.files.read(settings.file);
        const overrides = settings.map(
          source === undefined ? {} : JSON.parse(source),
        );
        if (!this.isStopped && source !== snapshot.source) {
          snapshot.source = source;
          snapshot.overrides = overrides;
          this.overrides = Object.freeze(
            Object.assign(
              {},
              ...[...this.snapshots.values()].map((item) => item.overrides),
            ),
          );
          this.options.changed();
        }
      } catch (error) {
        if (!snapshot.hasWarned) {
          snapshot.hasWarned = true;
          this.options.warn(
            `Could not read Obsidian ${settings.file}; keeping the last good settings.`,
            error,
          );
        }
      }
    });
    return this.settingsQueue;
  }

  private snapshot(file: ConfigFile): SettingsSnapshot {
    let snapshot = this.snapshots.get(file);
    if (!snapshot) {
      snapshot = { source: undefined, overrides: {}, hasWarned: false };
      this.snapshots.set(file, snapshot);
    }
    return snapshot;
  }
}
