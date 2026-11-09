/**
 * EmbedPDF's engine host with Lumiere's page reader.
 *
 * `WorkerHost` (engine-services) is what runs PDFium for an engine: it takes
 * the requests of the engine's queue and answers them. Its page render is the
 * one place a page's colours could be decided, and EmbedPDF 3 gives it no
 * option for that. This host does the render as EmbedPDF does, and when the
 * page colours are dark it also renders the page with PDFium's colour scheme
 * and turns the two into a dark page (`darkenPage`, shared/dark-page.ts). The
 * answer has the shape of any page render, so the viewer's render plugin, its
 * tiles and its cache work as they do on white paper.
 *
 * The mode is the host's state (`setPageColors`), not part of a request:
 * EmbedPDF's render plugin forwards no option it does not know. A viewer that
 * changes it invalidates its pictures afterwards, so the renders it asks for
 * next are drawn in the new mode.
 */
import {
  PageRenderReader,
  WorkerHost,
  type DocumentSession,
  type WorkerHostOptions,
} from "@embedpdf/engine-services";
import type { PdfRuntimeModule } from "@embedpdf/engine-runtime";
import type {
  PagesRenderWorkerRequest,
  PdfCoordinates,
  WirePack,
  WorkerRequest,
  WorkerResponse,
  WorkerResultPayload,
} from "@embedpdf/engine-core/runtime";
import { darkenPage, FORCED_PAGE_COLORS } from "../shared/dark-page";
import type { EffectivePageColors } from "../shared/page-colors";
import { withColorScheme } from "./color-scheme-runtime";

type PageRenderRequest = PagesRenderWorkerRequest<PdfCoordinates>;
type RenderAnswer = WirePack<WorkerResultPayload<PdfCoordinates>>;

/** The parts of `WorkerHost` this host reaches into; it declares them private. */
interface HostInternals {
  readonly slices: { readonly budgetMs: number; between(): Promise<void> };
  requireSession(request: PageRenderRequest): DocumentSession;
  handlePagesRender(
    request: PageRenderRequest,
    signal: AbortSignal,
  ): Promise<RenderAnswer>;
}

/** What a test may set of the host: how long PDFium works before it pauses. */
export type DarkHostOptions = Pick<WorkerHostOptions, "sliceMs">;

/** An engine host that can draw pages on dark paper. */
export interface DarkHost {
  receive(request: WorkerRequest): void;
  setPageColors(mode: EffectivePageColors): void;
}

export function createDarkHost(
  runtime: PdfRuntimeModule,
  post: (pack: WirePack<WorkerResponse>) => void,
  options: DarkHostOptions = {},
): DarkHost {
  const host = new WorkerHost(runtime, post, options);
  const internals = host as unknown as HostInternals;
  // Pinned to the EmbedPDF release in package.json: a release that renames
  // these must fail here, not leave dark pages quietly white.
  if (
    typeof internals.handlePagesRender !== "function" ||
    typeof internals.requireSession !== "function" ||
    typeof internals.slices?.between !== "function"
  ) {
    throw new Error("This EmbedPDF release's engine host has changed shape");
  }
  const asAuthored = internals.handlePagesRender.bind(host);
  const scheme = withColorScheme(runtime, FORCED_PAGE_COLORS);
  let mode: EffectivePageColors = "normal";
  internals.handlePagesRender = async (request, signal) => {
    const answer = await asAuthored(request, signal);
    if (mode !== "dark") {
      return answer;
    }
    return darkened(answer, async () => {
      const session = internals.requireSession(request);
      const { raster } = await new PageRenderReader(scheme, session).render(
        session.resolvePageRef(request.page).pageObjectNumber,
        { ...request.options, background: "transparent" },
        signal,
        internals.slices,
      );
      return raster.data;
    });
  };
  return {
    receive: (request) => host.receive(request),
    setPageColors: (next) => {
      mode = next;
    },
  };
}

/**
 * The page render `answer`, as dark paper. `forcedPixels` renders the same
 * page with the colour scheme, after the render as authored: they share the
 * host's one PDFium, which runs one render at a time.
 */
async function darkened(
  answer: RenderAnswer,
  forcedPixels: () => Promise<ArrayBuffer>,
): Promise<RenderAnswer> {
  const { payload } = answer;
  if (payload.tag !== "pages.render") {
    throw new Error(`A page render answered ${payload.tag}`);
  }
  const forced = await forcedPixels();
  darkenPage(
    new Uint8ClampedArray(payload.raster.data),
    new Uint8ClampedArray(forced),
  );
  return answer;
}
