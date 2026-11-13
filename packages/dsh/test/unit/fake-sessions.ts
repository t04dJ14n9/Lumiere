import type { DshContext } from "../../src/host/dsh";

/** Sessions DSH knows: `live` in `ctx.sessions`, `stored` only in persistence. */
export interface Sessions {
  /** Session id to its working directory (undefined: a session without one). */
  readonly live?: Readonly<Record<string, string | undefined>>;
  readonly stored?: Readonly<Record<string, string | undefined>>;
  /** A composition without `sessionPersistence`. */
  readonly noPersistence?: boolean;
}

/** The session services of a DSH context, over what `known` lists. */
export function dshSessions(
  known: Sessions,
): Pick<DshContext, "sessions" | "get"> {
  const header = (cwd: string | undefined) => ({
    header: cwd === undefined ? {} : { cwd },
  });
  return {
    sessions: {
      get: (id) =>
        id in (known.live ?? {}) ? header(known.live?.[id]) : undefined,
    },
    get: () =>
      known.noPersistence
        ? undefined
        : {
            stat: async (id: string) =>
              id in (known.stored ?? {})
                ? header(known.stored?.[id])
                : undefined,
          },
  };
}
