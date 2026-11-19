/** What one shown embed holds. */
interface EmbedLife {
  readonly events: AbortController;
  readonly disposers: (() => void)[];
  /** The resource it shows (a vault file's URI), once loaded. */
  source?: string;
}

/**
 * What each embed of a render pass holds while it shows its file: its event
 * listeners, its teardowns and the file it shows. An embed shown again
 * (its file changed) releases what it held first, so its old listeners,
 * nested render and media do not outlive what replaced them.
 */
export class EmbedLives<Node> {
  private readonly lives = new Map<Node, EmbedLife>();

  /** Aborted when the embed is released. */
  signal(node: Node): AbortSignal {
    return this.life(node).events.signal;
  }

  /** Runs when the embed is released, after those added later. */
  onRelease(node: Node, dispose: () => void): void {
    this.life(node).disposers.push(dispose);
  }

  setSource(node: Node, source: string): void {
    this.life(node).source = source;
  }

  /** The embeds showing any of these files. */
  showing(sources: ReadonlySet<string>): Node[] {
    const nodes: Node[] = [];
    for (const [node, life] of this.lives) {
      if (life.source !== undefined && sources.has(life.source)) {
        nodes.push(node);
      }
    }
    return nodes;
  }

  release(node: Node): void {
    const life = this.lives.get(node);
    if (!life) {
      return;
    }
    this.lives.delete(node);
    life.events.abort();
    for (const dispose of life.disposers.reverse()) {
      dispose();
    }
  }

  releaseAll(): void {
    for (const node of [...this.lives.keys()]) {
      this.release(node);
    }
  }

  private life(node: Node): EmbedLife {
    let life = this.lives.get(node);
    if (!life) {
      life = { events: new AbortController(), disposers: [] };
      this.lives.set(node, life);
    }
    return life;
  }
}
