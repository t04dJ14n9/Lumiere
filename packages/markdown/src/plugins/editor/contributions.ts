import type { EditorView } from "@codemirror/view";
import type { Disposer, Schema } from "@workshop/core";

export interface ViewStateContribution<T> {
  schema: Schema<T>;
  capture(view: EditorView): T;
  restore(view: EditorView, value: T, source: string): void;
  /**
   * Kept while the panel's view lives and carried when it moves (a rename,
   * Back and Forward in the panel), but neither saved for nor restored
   * after a reload: a fresh load starts from the note itself.
   */
  transient?: boolean;
}
export interface ViewStateContributions {
  contribute<T>(key: string, contribution: ViewStateContribution<T>): Disposer;
}

/** Unknown keys survive a round trip and can be consumed by a late plugin. */
export class ViewContributions implements ViewStateContributions {
  private values: Record<string, unknown> = {};
  private source = "";
  private legacy: Record<string, unknown> = {};
  /** Keys whose restored values were saved before a reload, not by this view. */
  private reloaded = new Set<string>();
  /** Keys whose contributors keep their state out of a reload. */
  private readonly transientKeys = new Set<string>();
  private readonly active = new Map<
    string,
    {
      capture(): unknown;
      restore(value: unknown): void;
    }
  >();
  constructor(
    private readonly view: EditorView,
    private readonly beforeRestore?: () => void,
  ) {}
  restore(
    values: Record<string, unknown>,
    source: string,
    legacy: Record<string, unknown> = {},
    options: { reloaded?: boolean } = {},
  ): void {
    this.values = { ...values };
    this.source = source;
    this.legacy = legacy;
    this.reloaded = new Set(
      options.reloaded ? [...Object.keys(values), ...Object.keys(legacy)] : [],
    );
    for (const [key, contribution] of this.active) {
      if (this.restores(key)) {
        contribution.restore(this.saved(key));
      }
    }
  }
  /** `forReload`: what a reload may start from, without transient state. */
  capture(options: { forReload?: boolean } = {}): Record<string, unknown> {
    const values = { ...this.legacy, ...this.values };
    for (const [key, contribution] of this.active) {
      values[key] = contribution.capture();
    }
    if (options.forReload) {
      for (const key of this.transientKeys) {
        delete values[key];
      }
    }
    return values;
  }
  private restores(key: string): boolean {
    if (this.reloaded.has(key) && this.transientKeys.has(key)) {
      return false;
    }
    return Object.hasOwn(this.values, key) || Object.hasOwn(this.legacy, key);
  }
  private saved(key: string): unknown {
    return Object.hasOwn(this.values, key)
      ? this.values[key]
      : this.legacy[key];
  }
  contribute<T>(key: string, contribution: ViewStateContribution<T>): Disposer {
    if (this.active.has(key)) {
      throw new Error(`Duplicate view-state contribution: ${key}`);
    }
    const entry = {
      capture: () => contribution.schema.parse(contribution.capture(this.view)),
      restore: (value: unknown) => {
        let parsed: T;
        try {
          parsed = contribution.schema.parse(value);
        } catch {
          return;
        }
        contribution.restore(this.view, parsed, this.source);
      },
    };
    this.active.set(key, entry);
    if (contribution.transient) {
      this.transientKeys.add(key);
    }
    if (this.restores(key)) {
      this.beforeRestore?.();
      entry.restore(this.saved(key));
    }
    return () => {
      if (this.active.get(key) !== entry) {
        return;
      }
      this.values[key] = entry.capture();
      this.reloaded.delete(key);
      this.active.delete(key);
    };
  }
}
