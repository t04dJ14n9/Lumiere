import { EditorSelection } from "@codemirror/state";
import type { EditorState } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import type { Context, Infer, Plugin } from "@workshop/core";
import type {} from "../editor/api";
import type {} from "../commands/api";
import type {} from "../render/api";
import type { DocHunk, GitDiff } from "./api";
import type {
  DiffHunk,
  DiffSnapshot,
  HunkRef,
  LineRecord,
} from "../../shared/git-diff";
import { sourceStateEquals } from "../../shared/git-diff";
import { changeGutter } from "./gutter";
import { stageControlEnabled } from "./mutations";
import { docHunkForDiffHunk, revertDisplayedHunk } from "./revert-run";
import { DiffSession } from "./session";
import {
  MAX_DIFF_CHARS,
  MAX_DIFF_LINES,
  exceedsDiffLimits,
  lineHunks,
} from "../../shared/diff";
import type { LineHunk } from "../../shared/diff";
import {
  computeHunks,
  hunkAt,
  hunkField,
  revertChange,
  setHunks,
} from "./hunks";
import { config } from "./manifest";
import {
  outerBlock,
  peekContext,
  peekExtension,
  peekedHunk,
  peekRef,
  peekState,
  peekTargetAt,
  setPeek,
} from "./peek";
import { protocol } from "./protocol";
import { BaselineSource } from "./baseline";
import { t } from "@workshop/l10n";

type Status = ReturnType<GitDiff["status"]>;
type Options = Infer<typeof config>;

/** Debounce between typing and recomputing the diff. */
const RECOMPUTE_MS = 250;

interface LiveDiff {
  readonly baseline: string;
  readonly docText: string;
  readonly lines: readonly LineHunk[];
}

/** The baseline, its hunks and the moves between them, for one editor. */
class GitDiffModel implements GitDiff {
  get field() {
    return hunkField;
  }
  private readonly source: BaselineSource;
  private state: Status = "loading";
  private fileUri = "live-document";
  private readonly session: DiffSession;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly ctx: Context,
    options: Options,
  ) {
    this.session = new DiffSession(options.compareTo);
    this.source = new BaselineSource(ctx, options.compareTo);
  }

  private get text(): string | undefined {
    return this.source.text;
  }

  get view(): EditorView {
    return this.ctx.editor.view;
  }
  status = () => this.state;
  blockRange(state: EditorState, from: number, to: number) {
    return outerBlock(state, from, to);
  }
  context(state: EditorState, hunk: DocHunk) {
    return peekContext(state, hunk);
  }
  label = () => this.source.label;
  baseline = () => this.text;

  onChange(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    this.source.stop();
    this.listeners.clear();
  }

  /**
   * Put a change back through the mutation gate. The edit is the validated
   * snapshot hunk; a disappeared change, or one that drifts before execute, is
   * left alone.
   */
  revert(hunk: Parameters<GitDiff["revert"]>[0]): void {
    void revertDisplayedHunk({
      session: this.session,
      hunk,
      fileUri: this.fileUri,
      baseline: this.text,
      docText: () => this.view.state.doc.toString(),
      hold: (locking) => this.hold(locking),
      apply: (validated, snapshot) => this.applyValidated(validated, snapshot),
    });
  }

  /** Record a keystroke so the gate sees it even before the debounced publish. */
  noteEdit(): void {
    this.session.noteEdit();
  }

  openHunk(ref: HunkRef, at?: number): void {
    const found = this.session.snapshot?.hunks.find(
      (hunk) =>
        hunk.hunkId === ref.hunkId && hunk.generationId === ref.generationId,
    );
    if (!found) {
      return;
    }
    // A mapped Show Diff control passes its current position. The snapshot
    // anchor is only the fallback when nothing has mapped the decoration.
    const anchor = at ?? found.liveAnchor?.from;
    if (anchor === undefined) {
      return;
    }
    this.view.dispatch({
      selection: EditorSelection.cursor(anchor),
      effects: setPeek.of({ at: anchor, ref }),
    });
    this.view.focus();
  }

  refFor(hunk: DocHunk): HunkRef | undefined {
    return this.session.refFor(hunk);
  }

  linesFor(hunk: DocHunk): readonly LineRecord[] {
    return this.session.linesFor(hunk);
  }

  /** Apply the gate's hunk, and only while the buffer is still that snapshot. */
  private applyValidated(hunk: DiffHunk, snapshot: DiffSnapshot): boolean {
    const auth = this.session.authoritativeSourceState();
    const baseline = this.text;
    if (!auth || baseline === undefined) {
      return false;
    }
    if (!sourceStateEquals(auth, snapshot.sourceState)) {
      return false;
    }
    const target = docHunkForDiffHunk(baseline, this.view.state.doc, hunk);
    if (!target) {
      return false;
    }
    this.view.dispatch({
      changes: revertChange(this.view.state, target),
      userEvent: "input.revert",
      scrollIntoView: true,
      effects: setPeek.of(null),
    });
    this.view.dispatch({ effects: setHunks.of(this.fresh()) });
    return true;
  }

  private async hold(locking: boolean): Promise<boolean> {
    try {
      return await this.ctx.rpc.call(protocol, "mutationLock", {
        hold: locking,
      });
    } catch {
      return false;
    }
  }

  /**
   * The line diff of the document as it is now, and its text; undefined
   * without a baseline or past the size limits. Sets the status.
   */
  private diffNow(): LiveDiff | undefined {
    const { doc } = this.view.state;
    const text = this.text;
    if (text === undefined) {
      this.state = this.source.status;
      return undefined;
    }
    const docTooLarge =
      doc.length > MAX_DIFF_CHARS || doc.lines > MAX_DIFF_LINES;
    if (docTooLarge || exceedsDiffLimits(text)) {
      this.state = "tooLarge";
      return undefined;
    }
    this.state = "ok";
    const docText = doc.toString();
    return { baseline: text, docText, lines: lineHunks(text, docText) };
  }

  /** The hunks of the document as it is now; none past the size limits. */
  private fresh(diff = this.diffNow()) {
    if (!diff) {
      return [];
    }
    return computeHunks(diff.baseline, this.view.state.doc, diff.lines);
  }

  recompute = (): void => {
    // One diff for the bars and the published snapshot.
    const diff = this.diffNow();
    const fresh = this.fresh(diff);
    const previous = this.session.snapshot;
    const baseline = this.text;
    if (baseline === undefined) {
      this.session.clear();
    } else {
      this.session.publish(
        this.fileUri,
        baseline,
        diff?.docText ?? this.view.state.doc.toString(),
        diff?.lines,
      );
    }
    const open = this.view.state.field(peekState, false) ?? null;
    const nextOpen = this.session.rematch(previous, open, fresh);
    this.view.dispatch({
      effects: [
        setHunks.of(fresh),
        ...(nextOpen !== open ? [setPeek.of(nextOpen)] : []),
      ],
    });
    for (const listener of this.listeners) {
      listener();
    }
  };

  /** Fetch the baseline again; recompute only when it changed. */
  load = async (): Promise<void> => {
    if (await this.source.refresh()) {
      this.recompute();
    }
  };

  /** Move the caret (and an open peek) to the next or previous change, wrapping. */
  move(target: EditorView, direction: 1 | -1, peek: boolean): boolean {
    const { hunks } = target.state.field(hunkField);
    if (hunks.length === 0) {
      return false;
    }
    const open = peekedHunk(target.state);
    const line = target.state.doc.lineAt(target.state.selection.main.head);
    const lineEdge = direction === 1 ? line.to : line.from;
    const anchor = open ? open.from : lineEdge;
    const ordered = direction === 1 ? hunks : [...hunks].reverse();
    const next =
      ordered.find((hunk) =>
        direction === 1 ? hunk.from > anchor : hunk.from < anchor,
      ) ?? ordered[0]!;
    this.ctx.editor.navigate(() =>
      target.dispatch({
        selection: EditorSelection.cursor(next.from),
        effects: [
          EditorView.scrollIntoView(next.from, { y: "center" }),
          ...(peek || open ? [setPeek.of(this.peekAnchor(next))] : []),
        ],
      }),
    );
    return true;
  }

  /** Open the peek for the change on these lines, or close it. */
  toggle = (target: EditorView, from: number, to: number): void => {
    const hunk = peekTargetAt(target.state.field(hunkField).hunks, from, to);
    const open = peekedHunk(target.state);
    if (!hunk) {
      if (open) {
        target.dispatch({ effects: setPeek.of(null) });
      }
      return;
    }
    target.dispatch({
      selection: EditorSelection.cursor(hunk.from),
      effects: setPeek.of(open === hunk ? null : this.peekAnchor(hunk)),
    });
  };

  private peekAnchor(hunk: DocHunk) {
    const ref = this.session.refFor(hunk);
    return ref ? { at: hunk.from, ref } : hunk.from;
  }

  peekActions() {
    return {
      comparisonLabel: () =>
        this.session.snapshot
          ? t("{0} → Working tree", this.source.label)
          : this.source.label,
      move: (target: EditorView, direction: 1 | -1) =>
        this.move(target, direction, true),
      revert: (view: EditorView, hunk: DocHunk) => {
        if (this.peekMayRevert(view, hunk)) {
          this.revert(hunk);
        }
      },
      openFull: () => this.openFull(),
      lines: (hunk: DocHunk) => this.linesFor(hunk),
      canStage: () =>
        stageControlEnabled(this.session.snapshot, false) &&
        this.session.mutationAllowed(this.peekOpen()),
      canRevert: () => this.session.mutationAllowed(this.peekOpen()),
      close: (view: EditorView) => view.dispatch({ effects: setPeek.of(null) }),
    };
  }

  /** Nearest display keeps the old ref, which is not an exact hunk anymore. */
  private peekMayRevert(view: EditorView, displayed: DocHunk): boolean {
    const open = view.state.field(peekState, false) ?? null;
    if (!this.session.mutationAllowed(open)) {
      return false;
    }
    const stored = peekRef(open);
    const shown = this.session.refFor(displayed);
    if (!stored || !shown) {
      return false;
    }
    return (
      stored.hunkId === shown.hunkId &&
      stored.generationId === shown.generationId
    );
  }

  private peekOpen() {
    return this.view.state.field(peekState, false) ?? null;
  }

  private openFull(): void {
    const snap = this.session.snapshot;
    if (!snap) {
      return;
    }
    void this.ctx.rpc
      .call(protocol, "openFullDiff", {
        baseKind: snap.base.kind,
        targetKind: snap.target.kind,
      })
      .catch(() => undefined);
  }

  showChange = (): boolean => {
    const { state } = this.view;
    const line = state.doc.lineAt(state.selection.main.head);
    if (hunkAt(state.field(hunkField).hunks, line.from, line.to)) {
      this.toggle(this.view, line.from, line.to);
      return true;
    }
    return this.move(this.view, 1, true);
  };
}

/** Recompute the hunks a moment after typing stops. */
function debounce(model: GitDiffModel) {
  return ViewPlugin.define(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return {
      update(update) {
        if (!update.docChanged) {
          return;
        }
        // No copy of the document per keystroke: the edit only bumps the
        // version the Revert gate compares.
        model.noteEdit();
        if (model.baseline() !== undefined) {
          clearTimeout(timer);
          timer = setTimeout(model.recompute, RECOMPUTE_MS);
        }
      },
      destroy() {
        clearTimeout(timer);
      },
    };
  });
}

export const gitGutterWebview: Plugin<Options> = {
  name: "gitGutter",
  provides: ["gitDiff"],
  config,
  inject: { required: ["editor", "commands", "render", "rpc"] },
  apply(ctx, options) {
    const model = new GitDiffModel(ctx, options);
    ctx.effect(() => () => model.dispose());
    ctx.provide("gitDiff", model);
    ctx.effect(() =>
      ctx.editor.extend([
        hunkField,
        changeGutter({
          isOpen: (target, from, to) => {
            const open = peekedHunk(target.state);
            return Boolean(open && open.from <= to && open.to >= from);
          },
          click: model.toggle,
        }),
        peekExtension(model.peekActions()),
        debounce(model),
      ]),
    );
    ctx.effect(() => ctx.rpc.on(protocol, "changed", () => void model.load()));
    const commands: [string, () => boolean][] = [
      ["editor:git-next-change", () => model.move(model.view, 1, false)],
      ["editor:git-previous-change", () => model.move(model.view, -1, false)],
      ["editor:git-show-change", model.showChange],
    ];
    for (const [id, run] of commands) {
      ctx.effect(() => ctx.commands.register(id, run));
    }
    void model.load();
  },
};
