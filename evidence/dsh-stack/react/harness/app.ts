/**
 * Real-browser harness for DSH's note preview body (#736).
 *
 * Mounts the production `noteBody` component (bundled from the pr-737 source)
 * with React 19.3.1 + react-dom 19.3.1 in Chromium. The iframe it renders is
 * served by the harness server, which can answer slowly or with the editor's
 * bootstrap-failure page, so the scenarios in run.mjs reproduce:
 *
 *   single   - one render; the editor page loads after 500 ms.
 *   rerender - one parent re-render 50 ms after mount while the 500 ms load is
 *              still pending (React detaches the inline callback ref with null
 *              and re-attaches the same element).
 *   attempt  - the first frame loads DSH's "Lumiere could not open" bootstrap
 *              error; a content.revision bump then makes noteBody retry, which
 *              changes the iframe key (`${src}#${attempt}`) and replaces the
 *              frame; the second frame loads the editor page.
 *   replace  - the resource changes from A.md to B.md, changing the iframe key
 *              and src; A's slow load is abandoned, B's load settles.
 *
 * Observed values are recorded on window.__evidence; the iframe pages record
 * the theme/SHOWN messages they receive on window.__messages.
 */
import * as React from "/Users/t04dj14n9/Code/Lumia/.claude/worktrees/pr-737/node_modules/.pnpm/react@19.3.1/node_modules/react/index.js";
import { createRoot } from "/Users/t04dj14n9/Code/Lumia/.claude/worktrees/pr-737/node_modules/.pnpm/react-dom@19.3.1_react@19.3.1/node_modules/react-dom/client.js";

export interface BodyProps {
  readonly resourceAddress: string;
  readonly sessionId?: string;
  readonly content: {
    readonly kind: string;
    readonly revision?: number;
    loaded?(version: string): void;
    failed?(): void;
  };
  scrollportRef?(element: HTMLElement | null): void;
  useResource(address: string):
    | {
        readonly value?: {
          readonly absolutePath?: string;
          readonly version?: string;
        };
      }
    | undefined;
}

export type NoteBodyFactory = (
  react: unknown,
  open: (address: string) => void,
) => (props: BodyProps) => unknown;

interface Evidence {
  scenario: string;
  startedAt: number;
  loaded: Array<{ version: string; t: number }>;
  failed: Array<{ mark: string; t: number }>;
  actions: Array<{ action: string; t: number }>;
  parentRenders: number;
  bodyRenders: number;
  openCalls: string[];
  /** Raw DOM load events seen by the harness on each attached iframe. */
  nativeLoads: Array<{ t: number; url: string | null }>;
}

declare global {
  interface Window {
    __evidence: Evidence;
    __frames: HTMLIFrameElement[];
  }
}

const scenario =
  new URLSearchParams(location.search).get("scenario") ?? "single";

const evidence: Evidence = {
  scenario,
  startedAt: performance.now(),
  loaded: [],
  failed: [],
  actions: [],
  parentRenders: 0,
  bodyRenders: 0,
  openCalls: [],
  nativeLoads: [],
};
window.__evidence = evidence;
window.__frames = [];
const instrumented = new WeakSet<HTMLIFrameElement>();

function App({ Body }: { Body: (props: BodyProps) => unknown }): unknown {
  evidence.parentRenders += 1;
  const [address, setAddress] = React.useState<"A" | "B">("A");
  const [revision, setRevision] = React.useState(0);
  const [, setGeneration] = React.useState(0);

  React.useEffect(() => {
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    const schedule = (delay: number, action: string, run: () => void) => {
      timers.push(
        setTimeout(() => {
          evidence.actions.push({ action, t: performance.now() });
          run();
        }, delay),
      );
    };
    if (scenario === "rerender") {
      schedule(50, "parent-rerender", () => setGeneration((n) => n + 1));
    }
    if (scenario === "attempt") {
      schedule(450, "content-revision-bump", () => setRevision(1));
    }
    if (scenario === "replace") {
      schedule(80, "resource-switch-A-to-B", () => setAddress("B"));
    }
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, []);

  const version = address === "A" ? "1" : "2";
  const absolutePath = `/v/${address}.md`;
  const props: BodyProps = {
    resourceAddress: `dsh-resource://file/session/s/${address}.md`,
    sessionId: "s",
    content: {
      kind: "renderer",
      revision,
      loaded: (loadedVersion: string) => {
        evidence.loaded.push({ version: loadedVersion, t: performance.now() });
      },
      failed: () => {
        evidence.failed.push({ mark: "failed", t: performance.now() });
      },
    },
    scrollportRef: (element: HTMLElement | null) => {
      if (!element) return;
      const frame = element as HTMLIFrameElement;
      window.__frames.push(frame);
      if (!instrumented.has(frame)) {
        instrumented.add(frame);
        frame.addEventListener("load", () => {
          let url: string | null = null;
          try {
            url = frame.contentDocument ? frame.contentDocument.URL : null;
          } catch (error) {
            url = String(error);
          }
          evidence.nativeLoads.push({ t: performance.now(), url });
        });
      }
    },
    useResource: () => ({ value: { absolutePath, version } }),
  };
  return React.createElement(Body as never, props as never);
}

export function mount(factory: NoteBodyFactory): void {
  const Body = factory(React, (address: string) => {
    evidence.openCalls.push(address);
  });
  const counted = (props: BodyProps): unknown => {
    evidence.bodyRenders += 1;
    return Body(props);
  };
  createRoot(document.getElementById("root") as HTMLElement).render(
    React.createElement(App as never, { Body: counted } as never),
  );
}
