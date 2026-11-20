import type { Endpoint } from "../../shared/rpc/endpoint";
import { CancelToken } from "../../shared/rpc/lifecycle";
import { protocol, type SearchResponse } from "./protocol";
import { errorMessage } from "../../shared/errors";
export type SearchUpdate =
  /** A query started: nothing found yet. */
  | { loading: true }
  /** A query started again: what it found last time stays until it ends. */
  | { loading: true; refreshing: true }
  /** Matches the running query found since the last update, to append. */
  | { loading: true; added: SearchResponse["results"]; unreadable: number }
  | ({ loading: false; error?: string } & Partial<SearchResponse>);
interface Subscription {
  query: string;
  source: string;
  id?: string;
  update(value: SearchUpdate): void;
  token?: CancelToken;
  /** The matches streamed so far by the running query. */
  partial?: SearchResponse;
  /** The last complete result, shown while the query runs again. */
  settled?: SearchResponse;
}
export class QueryClient {
  private readonly subscriptions = new Set<Subscription>();
  private disposed = false;
  private nextId = 0;
  private readonly stopPartial: () => void | Promise<void>;
  constructor(private readonly rpc: Endpoint) {
    this.stopPartial = rpc.on(protocol, "partial", (message) => {
      for (const subscription of this.subscriptions) {
        if (subscription.id === message.id && !subscription.token?.cancelled) {
          receivePartial(subscription, message);
        }
      }
    });
  }
  watch(
    query: string,
    source: string,
    update: (value: SearchUpdate) => void,
  ): () => void {
    if (this.disposed) {
      return () => {};
    }
    const subscription: Subscription = { query, source, update };
    this.subscriptions.add(subscription);
    this.start(subscription);
    return () => {
      this.subscriptions.delete(subscription);
      subscription.token?.cancel();
    };
  }
  refresh(): void {
    for (const subscription of this.subscriptions) {
      this.start(subscription);
    }
  }
  private start(subscription: Subscription): void {
    subscription.token?.cancel();
    const token = new CancelToken();
    subscription.token = token;
    const id = `q${++this.nextId}`;
    subscription.id = id;
    delete subscription.partial;
    // An index change re-runs the query: emptying the block until the new
    // results arrive would make it flicker after every typing pause.
    subscription.update(
      subscription.settled
        ? { loading: true, refreshing: true }
        : { loading: true },
    );
    // A large vault takes longer than the default RPC deadline; the token
    // ends the query when the block refreshes or goes away.
    void this.rpc
      .call(
        protocol,
        "query",
        { query: subscription.query, source: subscription.source, id },
        { token, timeout: Number.POSITIVE_INFINITY },
      )
      .then(
        (response) => {
          if (!token.cancelled) {
            subscription.settled = response;
            subscription.update({ loading: false, ...response });
          }
        },
        (error) => {
          if (!token.cancelled) {
            // What is on screen stays: the last result, or what this run found.
            subscription.update({
              loading: false,
              error: errorMessage(error),
              ...(subscription.settled ?? subscription.partial),
            });
          }
        },
      );
  }
  dispose(): void {
    this.disposed = true;
    void this.stopPartial();
    for (const subscription of this.subscriptions) {
      subscription.token?.cancel();
    }
    this.subscriptions.clear();
  }
}

/** Partials carry only new matches: each one costs what it adds. */
function receivePartial(
  subscription: Subscription,
  message: SearchResponse,
): void {
  subscription.partial ??= { results: [], unreadable: 0 };
  for (const result of message.results) {
    subscription.partial.results.push(result);
  }
  subscription.partial.unreadable = message.unreadable;
  if (subscription.settled) {
    // Refreshing: the last result stays until this run's whole result.
    return;
  }
  subscription.update({
    loading: true,
    added: message.results,
    unreadable: message.unreadable,
  });
}
