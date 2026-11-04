import type { Logger } from "@workshop/core";
import type { TreeHandle, TreeNode } from "../../shared/host";
import type { EditorPanel, Editors } from "../editor/api";
import { protocol as editorProtocol } from "../editor/protocol";
import type { OutlineSource } from "./tree";

const REFRESH_DELAY_MS = 300;

interface OutlineViewOptions {
  tree: TreeHandle;
  source: OutlineSource;
  editors: Pick<Editors, "active">;
  followsCursor(): boolean;
  expandMode(): "accordion" | "all";
  logger: Logger;
}

/**
 * How long after a click on an outline row the jump it made is left alone:
 * long enough for a double-click's second click and the editor's reply.
 */
const OUTLINE_JUMP_MS = 1000;

/** A heading a click in the outline opened, and whether the caret got there. */
interface OutlineJump {
  id: string;
  until: number;
  landed: boolean;
}

/** Owns refresh timing and rejects caret captures from an obsolete panel or text. */
export class OutlineView {
  private panel: EditorPanel | undefined;
  private outlineJump: OutlineJump | undefined;
  private sourceVersion = 0;
  private revision = 0;
  private followRequest = 0;
  /**
   * Ids of the parents the accordion has left open; undefined when the tree
   * is fresh or Expand All opened it, so what is open is not known.
   */
  private openBranches: ReadonlySet<string> | undefined;
  private isDisposed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** The accordion's tree work in progress (see `oneAtATime`). */
  private treeWork: Promise<void> = Promise.resolve();

  constructor(private readonly options: OutlineViewOptions) {}

  /**
   * A click on the outline row of the heading at `offset` opened it. Until
   * the caret moves on from there, the tree is not laid out again: the row
   * is already selected, and the accordion's collapse would move rows under
   * the pointer, so the second click of a double-click landed on another
   * heading (and jumped there). The editor first reports its caret from
   * before the click, as it takes focus, so that is left alone too.
   */
  jumpedTo(offset: number): void {
    const node = this.options.source.activeNode(offset);
    this.outlineJump = node && {
      id: node.id,
      until: Date.now() + OUTLINE_JUMP_MS,
      landed: false,
    };
  }

  schedule(): void {
    this.followRequest++;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.refresh(), REFRESH_DELAY_MS);
  }

  refresh(): void {
    if (this.isDisposed) {
      return;
    }
    clearTimeout(this.timer);
    this.revision++;
    this.followRequest++;
    this.panel = this.options.editors.active();
    const document = this.panel?.document;
    this.sourceVersion = document?.version ?? 0;
    this.options.source.set(document?.uri, document?.getText() ?? "");
    this.options.tree.setMessage(
      this.options.source.isEmpty ? "No headings." : undefined,
    );
    this.options.source.parentsStartExpanded =
      this.options.expandMode() === "all";
    // An edit refreshes the tree after every pause in typing. Where rows stay
    // open across a refresh (VS Code), what the accordion opened is still
    // open: forgetting it would collapse the whole tree, a visible flash,
    // on the next follow each time.
    if (!this.options.tree.keepsExpansion) {
      this.openBranches = undefined;
    }
    this.options.tree.refresh();
    void this.followCaret();
  }

  /** Follow the active panel's caret. */
  followCaret(): Promise<void> {
    return this.follow((panel) =>
      panel.rpc.call(editorProtocol, "captureCursor", {}),
    );
  }

  /**
   * Follow where the reader is after a scroll in `panel` (see
   * `reading-position.ts`): the caret while it is on screen, else the line
   * at the middle of the editor.
   */
  followReading(
    panel: EditorPanel,
    position: { offset: number; version: number },
  ): Promise<void> {
    if (panel !== this.panel) {
      return Promise.resolve();
    }
    return this.follow(() =>
      Promise.resolve({ head: position.offset, version: position.version }),
    );
  }

  /** Detached event work has its own error sink, including closed-panel RPC failures. */
  private async follow(
    capture: (panel: EditorPanel) => Promise<{ head: number; version: number }>,
  ): Promise<void> {
    const request = ++this.followRequest;
    const panel = this.panel;
    if (!this.isAccordionOn()) {
      // The reader opens and closes rows while the accordion is off: what it
      // opened is no longer known when it comes back.
      this.openBranches = undefined;
    }
    if (!panel || !this.canFollow(panel, request)) {
      return;
    }
    try {
      await panel.ready;
      if (!this.canFollow(panel, request)) {
        return;
      }
      const caret = await capture(panel);
      if (
        !this.canFollow(panel, request) ||
        caret.version !== panel.session.version
      ) {
        return;
      }
      const node = this.options.source.activeNode(caret.head);
      if (!node || this.isOutlineJump(node)) {
        return;
      }
      if (this.isAccordionOn()) {
        const isCurrent = () => this.canFollow(panel, request);
        await this.oneAtATime(async () => {
          if (isCurrent()) {
            await this.applyAccordion(node, isCurrent);
          }
        });
      } else {
        await this.options.tree.reveal(node, { select: true, focus: false });
      }
    } catch (error) {
      if (this.canFollow(panel, request)) {
        this.options.logger.warn("Outline cursor follow failed", error);
      }
    }
  }

  /**
   * Run one follow's tree work after the previous one's. A tree call already
   * sent cannot be taken back: interleaved, an older follow's expand would
   * land after a newer one's collapse and leave its branch open.
   */
  private async oneAtATime(work: () => Promise<void>): Promise<void> {
    const run = this.treeWork.then(work);
    this.treeWork = run.catch(() => undefined);
    await run;
  }

  private canFollow(panel: EditorPanel, request: number): boolean {
    if (this.isDisposed || request !== this.followRequest) {
      return false;
    }
    try {
      return (
        this.options.followsCursor() &&
        this.options.tree.visible &&
        panel === this.panel &&
        panel === this.options.editors.active() &&
        panel.document.version === this.sourceVersion
      );
    } catch {
      // The plugin is stopping: its settings and editors are withdrawn
      // before dispose() runs, and a follow in flight must just stop.
      return false;
    }
  }

  /** Whether follow is on with the accordion; false once the plugin is stopping. */
  private isAccordionOn(): boolean {
    try {
      return (
        this.options.followsCursor() &&
        this.options.expandMode() === "accordion"
      );
    } catch {
      return false;
    }
  }

  async expandAll(): Promise<void> {
    const revision = this.revision;
    try {
      for (const node of this.options.source.allNodes()) {
        if (
          this.isDisposed ||
          revision !== this.revision ||
          !this.options.tree.visible
        ) {
          return;
        }
        await this.openForExpandAll(node);
      }
    } finally {
      // The tree is fully open. Forget which branches the accordion opened
      // so the next follow closes every other branch, even inside the same
      // section.
      this.openBranches = undefined;
    }
  }

  /**
   * Parents go through `expand`, which records them open. A later collapse
   * then changes collapsibleState. `reveal({ expand: true })` alone opens the
   * chevron without changing that state, and VS Code leaves it open.
   */
  private async openForExpandAll(node: TreeNode): Promise<void> {
    if (this.options.source.children(node).length > 0) {
      await this.options.tree.expand(node);
      return;
    }
    // Native reveal expands at most three levels, so each leaf is visited too.
    await this.options.tree.reveal(node, {
      expand: true,
      select: false,
      focus: false,
    });
  }

  /** Whether the caret at `node` is still where an outline click put it, or on its way. */
  private isOutlineJump(node: TreeNode): boolean {
    const jump = this.outlineJump;
    if (!jump || Date.now() > jump.until) {
      this.outlineJump = undefined;
      return false;
    }
    if (node.id === jump.id) {
      jump.landed = true;
      return true;
    }
    if (jump.landed) {
      // The caret moved on from the heading the click opened.
      this.outlineJump = undefined;
      return false;
    }
    // The caret from before the click, reported before the jump landed.
    return true;
  }

  /**
   * Open `active`'s path and select it. VS Code can close a single row only
   * through the whole-tree collapse, which flashes the tree shut and open
   * again, so there the tree is collapsed only when a branch that is open is
   * not on the path: a move that only opens rows (into a section that has
   * sub-sections, or deeper) leaves the rest alone. A tree without that
   * collapse closes rows one by one, without a flash, whenever the path
   * changes. `isCurrent` turns false when a newer follow takes over.
   */
  private async applyAccordion(
    active: TreeNode,
    isCurrent: () => boolean,
  ): Promise<void> {
    const path = this.options.source.pathTo(active);
    const expandIds = new Set<string>();
    for (const node of path) {
      if (this.options.source.children(node).length > 0) {
        expandIds.add(node.id);
      }
    }
    const open = this.openBranches;
    const toOpen = [...expandIds].filter((id) => !open?.has(id));
    const mustClose = !open || [...open].some((id) => !expandIds.has(id));
    const canOnlyOpen = this.options.tree.collapseAll !== undefined;
    const willReset = mustClose || (!canOnlyOpen && toOpen.length > 0);
    // Forget the model only when this follow will collapse or rebuild the
    // tree. An open-only follow that is superseded (common while scrolling)
    // must leave the previous set: otherwise the next follow treats the tree
    // as unknown and runs collapseAll, flashing shut rows that are still open.
    if (willReset) {
      this.openBranches = undefined;
    }
    let opened = new Set<string>();
    try {
      if (willReset) {
        await this.resetAccordion(path, expandIds, isCurrent);
      } else {
        opened = await this.expandPath(path, new Set(toOpen), isCurrent);
      }
    } catch (error) {
      // A failed follow leaves the model unknown so the next one lays the
      // whole path out again (collapseAll where the host has it).
      this.openBranches = undefined;
      throw error;
    }
    if (!isCurrent()) {
      // Open-only work may have expanded rows before this follow was
      // superseded. Remember them so a later sibling leave still sees
      // mustClose (without clearing to unknown, which would flash).
      if (!willReset && opened.size > 0) {
        this.openBranches = new Set([...(open ?? []), ...opened]);
      }
      return;
    }
    this.openBranches = expandIds;
    await this.options.tree.reveal(active, { select: true, focus: false });
  }

  private async resetAccordion(
    path: readonly TreeNode[],
    expandIds: ReadonlySet<string>,
    isCurrent: () => boolean,
  ): Promise<void> {
    if (this.options.tree.collapseAll) {
      await this.options.tree.collapseAll();
      await this.expandPath(path, expandIds, isCurrent);
      return;
    }
    await this.expandPath(path, expandIds, isCurrent);
    await this.collapseOthers(expandIds, isCurrent);
  }

  private async expandPath(
    path: readonly TreeNode[],
    expandIds: ReadonlySet<string>,
    isCurrent: () => boolean,
  ): Promise<Set<string>> {
    const opened = new Set<string>();
    for (const node of path) {
      if (!isCurrent()) {
        return opened;
      }
      if (expandIds.has(node.id)) {
        await this.options.tree.expand(node);
        // Count the expand even if a newer follow has already taken over:
        // the row is open in the tree and mustClose must see it next.
        opened.add(node.id);
      }
    }
    return opened;
  }

  private async collapseOthers(
    expandIds: ReadonlySet<string>,
    isCurrent: () => boolean,
  ): Promise<void> {
    for (const node of this.options.source.allNodes()) {
      if (!isCurrent()) {
        return;
      }
      if (
        this.options.source.children(node).length > 0 &&
        !expandIds.has(node.id)
      ) {
        await this.options.tree.collapse(node);
      }
    }
  }

  dispose(): void {
    this.isDisposed = true;
    this.followRequest++;
    clearTimeout(this.timer);
  }
}
