/**
 * The page's socket to its panel, kept open across a dropped connection.
 *
 * A socket that closes is opened again, with a growing delay, for as long as
 * the host keeps a panel whose page dropped (`RECONNECT_GRACE_MS` in
 * host/panel.ts). Frames sent meanwhile wait and go out in order once it is
 * open again; the editor then recovers any revision it missed through the
 * document's `catchUp`. When the host no longer knows the panel (it
 * restarted, or the grace passed), every attempt fails and the connection is
 * `lost`: the page must be reloaded, and what is typed until then would go
 * nowhere, so the page blocks typing while it is not `open`
 * (disconnected.ts).
 */

/** What the connection needs of a browser `WebSocket`. */
export interface SocketLike {
  readonly readyState: number;
  send(text: string): void;
  addEventListener(type: "open" | "close", listener: () => void): void;
  addEventListener(
    type: "message",
    listener: (event: { data: unknown }) => void,
  ): void;
}

/** `WebSocket.OPEN`, which Node's test harness has no global for. */
const OPEN = 1;

export type ConnectionState = "connecting" | "open" | "reconnecting" | "lost";

export interface Timers {
  after(ms: number, run: () => void): void;
  now(): number;
}

export interface ConnectionOptions {
  /** Opens a new socket to the panel. */
  readonly open: () => SocketLike;
  readonly receive: (text: string) => void;
  /** The connection opened again, dropped, or gave up. */
  readonly onState: (state: ConnectionState) => void;
  readonly timers?: Timers;
}

/** The first retry's delay; each later one doubles, up to `MAX_DELAY_MS`. */
export const FIRST_DELAY_MS = 250;
export const MAX_DELAY_MS = 4_000;
/** How long to keep trying: a little less than the host keeps the panel. */
export const GIVE_UP_AFTER_MS = 25_000;

const browserTimers: Timers = {
  after: (ms, run) => void setTimeout(run, ms),
  now: () => Date.now(),
};

/** Opens the socket and returns how to send a frame's text over it. */
export function reconnectingSocket(
  options: ConnectionOptions,
): (text: string) => void {
  const timers = options.timers ?? browserTimers;
  const waiting: string[] = [];
  let socket: SocketLike;
  let state: ConnectionState = "connecting";
  /** When the connection dropped, while it is down. */
  let droppedAt: number | undefined;
  let attempt = 0;

  function setState(next: ConnectionState): void {
    if (state !== next) {
      state = next;
      options.onState(next);
    }
  }

  function connect(): void {
    const current = options.open();
    socket = current;
    current.addEventListener("open", () => {
      droppedAt = undefined;
      attempt = 0;
      setState("open");
      for (const text of waiting.splice(0)) {
        current.send(text);
      }
    });
    current.addEventListener("message", (event) =>
      options.receive(String(event.data)),
    );
    // A socket that never opened closes too (the host refused the panel).
    current.addEventListener("close", () => retry());
  }

  function retry(): void {
    if (state === "lost") {
      return;
    }
    droppedAt ??= timers.now();
    if (timers.now() - droppedAt >= GIVE_UP_AFTER_MS) {
      setState("lost");
      return;
    }
    setState("reconnecting");
    const delay = Math.min(FIRST_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
    attempt += 1;
    timers.after(delay, connect);
  }

  connect();
  return (text) => {
    if (socket.readyState === OPEN) {
      socket.send(text);
    } else {
      waiting.push(text);
    }
  };
}
