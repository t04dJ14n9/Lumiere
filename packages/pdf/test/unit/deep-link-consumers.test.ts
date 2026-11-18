/**
 * Copy link writes `path#page=N#:~:text=…`. Every reader of that link must
 * open the PDF at page N: the links the product writes are only worth having
 * if the product can follow them.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { OPEN_NATIVE_LINK_COMMAND_ID } from "../../src/shared/command-ids";
import { localFragment, nativeLinks } from "../../src/shared/native-links";
import * as locations from "../../src/shared/pdf-location";
import {
  formatPdfDeepLink,
  parsePdfDeepLinkFragment,
} from "../../src/shared/text-fragment";
import { loadModule } from "./support/load-module";

const QUOTE = "Scaled dot-product attention";
const LINK = formatPdfDeepLink("papers/attention.pdf", {
  page: 3,
  text: QUOTE,
});
/** What a Markdown link click hands over: everything after the first `#`. */
const FRAGMENT = LINK.slice(LINK.indexOf("#") + 1);

test("the fragment Copy link writes is page, a second #, then the text directive", () => {
  assert.equal(
    FRAGMENT,
    "page=3#:~:text=Scaled%20dot%2Dproduct%20attention",
    "Markdown's openPdf accepts exactly this shape (packages/markdown navigation.ts)",
  );
});

test("the shared location readers take the page and ignore the text directive", () => {
  assert.deepEqual(locations.parseLocationFragment(FRAGMENT), { page: 3 });
  assert.deepEqual(locations.parseLocationFragment(`#${FRAGMENT}`), {
    page: 3,
  });
  assert.deepEqual(locations.parsePdfLocation(FRAGMENT), { page: 3 });
  assert.deepEqual(parsePdfDeepLinkFragment(FRAGMENT), {
    page: 3,
    textFragment: { textStart: QUOTE },
  });
  const boxed = locations.parseLocationFragment(
    "page=3&viewrect=72,83,134,21#:~:text=x",
  );
  assert.deepEqual(boxed, {
    page: 3,
    viewRect: { left: 72, top: 83, width: 134, height: 21 },
  });
});

test("splitFragmentDirective cuts at the second hash only", () => {
  assert.deepEqual(locations.splitFragmentDirective(FRAGMENT), {
    location: "page=3",
    directive: ":~:text=Scaled%20dot%2Dproduct%20attention",
  });
  assert.deepEqual(locations.splitFragmentDirective("#page=3&zoom=2"), {
    location: "page=3&zoom=2",
  });
  assert.equal(locations.parseLocationFragment("#:~:text=x"), undefined);
});

test("a quote that spans PDF lines still opens: the link carries no control characters", () => {
  const href = formatPdfDeepLink("papers/attention.pdf", {
    page: 3,
    text: "Scaled dot-product\nattention\r\nover   keys",
  });
  const markdown = `> [attention.pdf · p.3](${href})`;
  const link = nativeLinks(markdown).find((candidate) =>
    candidate.href.startsWith("papers/"),
  );
  assert.ok(link, "the Markdown link is found in the quote block");
  assert.doesNotMatch(link.href, /%0[AD]/iu);
  const parts = localFragment(link.href);
  assert.ok(parts, "native links accept the fragment");
  assert.deepEqual(locations.parseLocationFragment(parts.fragment), {
    page: 3,
  });
  assert.equal(
    parsePdfDeepLinkFragment(parts.fragment).textFragment?.textStart,
    "Scaled dot-product attention over keys",
  );
});

test("a deep link line in a note is a native link whose fragment opens page 3", () => {
  const markdown = `> [attention.pdf · p.3](${LINK})`;
  const link = nativeLinks(markdown).find((candidate) =>
    candidate.href.startsWith("papers/"),
  );
  assert.ok(link);
  const parts = localFragment(link.href);
  assert.deepEqual(parts, { path: "papers/attention.pdf", fragment: FRAGMENT });
  assert.deepEqual(locations.parseLocationFragment(parts!.fragment), {
    page: 3,
  });
});

interface Linkable {
  fragment: string;
  with(change: { fragment: string }): Linkable;
}

function uri(fragment: string): Linkable {
  return { fragment, with: (change) => uri(change.fragment) };
}

interface SourceLinkOptions {
  accepts(file: string, fragment: string): boolean;
  open(
    target: Linkable,
    root: unknown,
    column: number,
    run: { current(): boolean; cancel(): void },
  ): Promise<void>;
}

function loadNativeLinks() {
  const captured: { options?: SourceLinkOptions } = {};
  const delivered: unknown[] = [];
  const opened: Linkable[] = [];
  const exports = loadModule(
    new URL("../../src/extension/plugins/pdf/native-links.ts", import.meta.url),
    {
      vscode: {
        commands: {
          executeCommand: async (_command: string, target: Linkable) => {
            opened.push(target);
          },
        },
      },
      "node:fs/promises": { realpath: async (value: string) => value },
      "node:path": path,
      "../../../shared/pdf-location": locations,
      "./source-links": {
        registerSourceLinks: (options: SourceLinkOptions) => {
          captured.options = options;
          return { dispose: () => undefined };
        },
      },
      "./native-delivery": {
        deliverNativeLocation: async (_panel: unknown, location: unknown) => {
          delivered.push(location);
        },
      },
      "./panels": { VIEW_TYPE: "lumiere.pdf.viewer" },
      "../../../shared/command-ids": { OPEN_NATIVE_LINK_COMMAND_ID },
    },
  );
  const panel = {};
  (exports.registerNativeLinks as (panels: unknown) => unknown)({
    waitFor: async () => panel,
  });
  return { options: captured.options!, delivered, opened };
}

test("native source links claim a Copy link quote and deliver its page", async () => {
  const { options, delivered, opened } = loadNativeLinks();
  assert.equal(options.accepts("papers/attention.pdf", FRAGMENT), true);
  assert.equal(options.accepts("papers/attention.pdf", "page=3&zoom=2"), true);
  assert.equal(options.accepts("papers/attention.pdf", "nothing"), false);
  assert.equal(options.accepts("notes/a.md", "page=3"), false);
  await options.open(uri(FRAGMENT), {}, 1, {
    current: () => true,
    cancel: () => undefined,
  });
  assert.deepEqual(delivered, [{ page: 3 }]);
  assert.equal(opened[0]?.fragment, "", "the editor opens on the bare file");
});

test("a PDF opened through VS Code with a Copy link fragment goes to its page", () => {
  const jumps: unknown[] = [];
  class FakePanel {
    constructor(
      readonly uri: unknown,
      readonly webviewPanel: unknown,
      readonly options: unknown,
    ) {}
    goTo(location: unknown): void {
      jumps.push(location);
    }
  }
  const { PdfEditorProvider } = loadModule(
    new URL(
      "../../src/extension/plugins/pdf/editor-provider.ts",
      import.meta.url,
    ),
    {
      "../../../shared/pdf-location": locations,
      "./panel": { PdfPanel: FakePanel },
    },
  ) as {
    PdfEditorProvider: new (
      extensionUri: unknown,
      panels: unknown,
      preferences: unknown,
    ) => {
      resolveCustomEditor(document: unknown, webviewPanel: unknown): void;
    };
  };
  const provider = new PdfEditorProvider(
    {},
    {
      viewerToolbar: () => undefined,
      add: () => undefined,
    },
    { settings: () => ({}), position: () => undefined, save: () => undefined },
  );
  provider.resolveCustomEditor({ uri: uri(FRAGMENT) }, {});
  assert.deepEqual(jumps, [{ page: 3 }]);
});
