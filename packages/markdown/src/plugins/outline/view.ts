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
  /** Ids of parents the last accordion apply left open, so a repeat path is a no-op. */
  private lastAccordionKey: string | undefined;
  private isDisposed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

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
    this.lastAccordionKey = undefined;
    this.options.tree.refresh();
    void this.followCaret();
  }

  /** Detached event work has its own error sink, including closed-panel RPC failures. */
  async followCaret(): Promise<void> {
    const request = ++this.followRequest;
    const panel = this.panel;
    if (!panel || !this.canFollow(panel, request)) {
      return;
    }
    try {
      await panel.ready;
      if (!this.canFollow(panel, request)) {
        return;
      }
      const caret = await panel.rpc.call(editorProtocol, "captureCursor", {});
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
      if (
        this.options.followsCursor() &&
        this.options.expandMode() === "accordion"
      ) {
        await this.applyAccordion(node);
      } else {
        await this.options.tree.reveal(node, { select: true, focus: false });
      }
    } catch (error) {
      if (this.canFollow(panel, request)) {
        this.options.logger.warn("Outline cursor follow failed", error);
      }
    }
  }

  private canFollow(panel: EditorPanel, request: number): boolean {
    return (
      !this.isDisposed &&
      request === this.followRequest &&
      this.options.followsCursor() &&
      this.options.tree.visible &&
      panel === this.panel &&
      panel === this.options.editors.active() &&
      panel.document.version === this.sourceVersion
    );
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
      // The tree is fully open. Forget the last accordion path so the next
      // follow closes every other branch, even inside the same section.
      this.lastAccordionKey = undefined;
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

  private async applyAccordion(active: TreeNode): Promise<void> {
    const path = this.options.source.pathTo(active);
    const expandIds = new Set<string>();
    for (const node of path) {
      if (this.options.source.children(node).length > 0) {
        expandIds.add(node.id);
      }
    }
    const key = [...expandIds].sort().join("\0");
    if (key !== this.lastAccordionKey) {
      this.lastAccordionKey = key;
      await this.resetAccordion(path, expandIds);
    }
    await this.options.tree.reveal(active, { select: true, focus: false });
  }

  private async resetAccordion(
    path: readonly TreeNode[],
    expandIds: ReadonlySet<string>,
  ): Promise<void> {
    if (this.options.tree.collapseAll) {
      await this.options.tree.collapseAll();
      await this.expandPath(path, expandIds);
      return;
    }
    await this.expandPath(path, expandIds);
    await this.collapseOthers(expandIds);
  }

  private async expandPath(
    path: readonly TreeNode[],
    expandIds: ReadonlySet<string>,
  ): Promise<void> {
    for (const node of path) {
      if (expandIds.has(node.id)) {
        await this.options.tree.expand(node);
      }
    }
  }

  private async collapseOthers(expandIds: ReadonlySet<string>): Promise<void> {
    for (const node of this.options.source.allNodes()) {
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
