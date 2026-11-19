interface Checkpoint<State> {
  before: State;
  after: State;
  group?: string;
}
/**
 * Metadata over native undo steps, never an independent text/inverse-edit
 * stack. A checkpoint names the document's state before and after a step by
 * its content, compared with `same`: native undo gives the document a new
 * version, so only its content shows that a step's start was restored.
 */
export class UndoGroups<State = string> {
  private undo: Checkpoint<State>[] = [];
  private redo: Checkpoint<State>[] = [];
  constructor(
    private readonly same: (left: State, right: State) => boolean = Object.is,
  ) {}
  clear(): void {
    this.undo = [];
    this.redo = [];
  }
  record(before: State, after: State, group?: string): void {
    if (this.same(before, after)) {
      return;
    }
    this.undo.push({
      before,
      after,
      ...(group === undefined ? {} : { group }),
    });
    this.redo = [];
  }
  async run(
    action: "undo" | "redo",
    current: () => State,
    native: () => Promise<unknown>,
  ): Promise<void> {
    const from = action === "undo" ? this.undo : this.redo;
    const to = action === "undo" ? this.redo : this.undo;
    const first = from.at(-1);
    const group = first?.group;
    const start = (step: Checkpoint<State>) =>
      action === "undo" ? step.after : step.before;
    const end = (step: Checkpoint<State>) =>
      action === "undo" ? step.before : step.after;
    if (!first || !this.same(current(), start(first))) {
      this.clear();
      await native();
      return;
    }
    do {
      const step = from.at(-1)!;
      if (!this.same(current(), start(step))) {
        this.clear();
        return;
      }
      await native();
      if (!this.same(current(), end(step))) {
        this.clear();
        return;
      }
      from.pop();
      to.push(step);
    } while (group !== undefined && from.at(-1)?.group === group);
  }
}
