import test from "node:test";
import assert from "node:assert/strict";
import {
  FIRST_DELAY_MS,
  GIVE_UP_AFTER_MS,
  MAX_DELAY_MS,
  reconnectingSocket,
  type ConnectionState,
  type SocketLike,
} from "../../src/page/connection";

class FakeSocket implements SocketLike {
  readyState = 0;
  readonly sent: string[] = [];
  private readonly listeners = new Map<string, ((event: never) => void)[]>();
  addEventListener(type: string, listener: (event: never) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  send(text: string): void {
    this.sent.push(text);
  }
  open(): void {
    this.readyState = 1;
    this.emit("open", undefined);
  }
  close(): void {
    this.readyState = 3;
    this.emit("close", undefined);
  }
  message(data: string): void {
    this.emit("message", { data });
  }
  private emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event as never);
    }
  }
}

function harness() {
  const sockets: FakeSocket[] = [];
  const states: ConnectionState[] = [];
  const received: string[] = [];
  const delays: number[] = [];
  let pending: (() => void) | undefined;
  let clock = 0;
  const send = reconnectingSocket({
    open: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    receive: (text) => received.push(text),
    onState: (state) => states.push(state),
    timers: {
      after: (ms, run) => {
        delays.push(ms);
        pending = run;
      },
      now: () => clock,
    },
  });
  return {
    send,
    sockets,
    states,
    received,
    delays,
    latest: () => sockets.at(-1)!,
    /** Let time pass and run the scheduled retry. */
    retry(): void {
      clock += delays.at(-1) ?? 0;
      const run = pending;
      pending = undefined;
      run?.();
    },
    advance(ms: number): void {
      clock += ms;
    },
  };
}

test("frames wait until the socket opens, then go in order", () => {
  const page = harness();
  page.send("a");
  page.send("b");
  assert.deepEqual(page.latest().sent, []);
  page.latest().open();
  page.send("c");
  assert.deepEqual(page.latest().sent, ["a", "b", "c"]);
  assert.deepEqual(page.states, ["open"]);
  page.latest().message("hello");
  assert.deepEqual(page.received, ["hello"]);
});

test("a dropped socket reconnects, and what was sent meanwhile goes out on the new one", () => {
  const page = harness();
  page.latest().open();
  page.latest().close();
  assert.deepEqual(page.states, ["open", "reconnecting"]);
  page.send("typed while away");
  page.retry();
  assert.equal(page.sockets.length, 2);
  page.latest().open();
  assert.deepEqual(page.latest().sent, ["typed while away"]);
  assert.deepEqual(page.states, ["open", "reconnecting", "open"]);
});

test("each failed attempt waits twice as long, up to the cap, and success resets the delay", () => {
  const page = harness();
  page.latest().open();
  page.latest().close();
  for (let i = 0; i < 6; i++) {
    page.retry();
    page.latest().close();
  }
  assert.deepEqual(page.delays, [
    FIRST_DELAY_MS,
    FIRST_DELAY_MS * 2,
    FIRST_DELAY_MS * 4,
    FIRST_DELAY_MS * 8,
    MAX_DELAY_MS,
    MAX_DELAY_MS,
    MAX_DELAY_MS,
  ]);
  page.retry();
  page.latest().open();
  page.latest().close();
  assert.equal(page.delays.at(-1), FIRST_DELAY_MS);
});

test("a host that no longer knows the panel is given up on, and nothing more is tried", () => {
  const page = harness();
  page.latest().open();
  page.latest().close();
  page.advance(GIVE_UP_AFTER_MS);
  page.retry();
  page.latest().close();
  assert.equal(page.states.at(-1), "lost");
  const attempts = page.sockets.length;
  page.retry();
  assert.equal(page.sockets.length, attempts);
});

test("a page whose first socket never opens is reconnecting, not silently waiting", () => {
  const page = harness();
  page.latest().close();
  assert.deepEqual(page.states, ["reconnecting"]);
});
