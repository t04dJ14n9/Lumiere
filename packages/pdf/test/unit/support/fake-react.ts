type Deps = readonly unknown[] | undefined;

interface Effect {
  deps: Deps;
  cleanup: (() => void) | undefined;
  ran: boolean;
}

/**
 * React's hooks, as far as the viewer's hooks use them, for running a hook
 * function as a component rendered again and again without React: state and
 * refs persist between `render` calls, and an effect runs after its render
 * when its dependencies changed, cleaning up before it runs again. Pass
 * `react` as the module the hook imports.
 */
export function fakeReact() {
  const slots: unknown[] = [];
  let cursor = 0;
  let pending: (() => void)[] = [];
  const slot = <T>(create: () => T): T => {
    if (cursor >= slots.length) {
      slots.push(create());
    }
    return slots[cursor++] as T;
  };
  const effectHook = (run: () => (() => void) | void, deps: Deps): void => {
    const effect = slot<Effect>(() => ({
      deps: undefined,
      cleanup: undefined,
      ran: false,
    }));
    const unchanged =
      effect.ran &&
      deps !== undefined &&
      effect.deps !== undefined &&
      deps.length === effect.deps.length &&
      deps.every((dep, index) => Object.is(dep, effect.deps![index]));
    if (unchanged) {
      return;
    }
    pending.push(() => {
      effect.cleanup?.();
      effect.cleanup = run() ?? undefined;
      effect.deps = deps;
      effect.ran = true;
    });
  };
  const react = {
    useRef: <T>(initial: T) => slot(() => ({ current: initial })),
    useState: <T>(initial: T | (() => T)) => {
      const cell = slot(() => {
        const value = {
          current: (typeof initial === "function"
            ? (initial as () => T)()
            : initial) as T,
        };
        return {
          value,
          set: (next: T | ((previous: T) => T)): void => {
            value.current =
              typeof next === "function"
                ? (next as (previous: T) => T)(value.current)
                : next;
          },
        };
      });
      return [cell.value.current, cell.set] as const;
    },
    useCallback: <T>(callback: T) => callback,
    useEffect: effectHook,
    useLayoutEffect: effectHook,
  };
  return {
    react,
    /** Run `component` once, then the effects it asked for. */
    render<T>(component: () => T): T {
      cursor = 0;
      pending = [];
      const result = component();
      for (const run of pending) {
        run();
      }
      return result;
    },
  };
}
