/**
 * The engine's host in the page's own thread, for when no worker can start.
 * EmbedPDF's own in-thread transport (`createLocalEngine`) runs its stock
 * host, which cannot draw dark paper; this one runs Lumiere's (dark-host.ts),
 * so the fallback draws pages as the worker does.
 */
import type { Transport } from "@embedpdf/engine";
import type { PdfRuntimeModule } from "@embedpdf/engine-runtime";
import type {
  WirePack,
  WorkerRequest,
  WorkerResponse,
} from "@embedpdf/engine-core/runtime";
import type { EffectivePageColors } from "../shared/page-colors";
import {
  createDarkHost,
  type DarkHost,
  type DarkHostOptions,
} from "./dark-host";

export class DarkInlineTransport implements Transport {
  private readonly host: DarkHost;
  private readonly listeners = new Set<(response: WorkerResponse) => void>();
  private ended = false;

  constructor(runtime: PdfRuntimeModule, options: DarkHostOptions = {}) {
    // No thread boundary: the response's transfer list means nothing.
    this.host = createDarkHost(
      runtime,
      (pack) => this.deliver(pack.payload),
      options,
    );
  }

  send(pack: WirePack<WorkerRequest>): void {
    // Asynchronous, as a worker's is: the caller's synchronous code finishes
    // before any request is handled.
    queueMicrotask(() => {
      if (!this.ended) {
        this.host.receive(pack.payload);
      }
    });
  }

  onMessage(handler: (response: WorkerResponse) => void): () => void {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }

  setPageColors(mode: EffectivePageColors): void {
    this.host.setPageColors(mode);
  }

  async terminate(): Promise<void> {
    this.ended = true;
    this.listeners.clear();
  }

  private deliver(response: WorkerResponse): void {
    for (const listener of this.listeners) {
      try {
        listener(response);
      } catch {
        // One listener's failure must not keep the others from the response.
      }
    }
  }
}
