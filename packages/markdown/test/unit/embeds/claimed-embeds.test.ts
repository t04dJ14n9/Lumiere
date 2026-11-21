import assert from "node:assert/strict";
import test from "node:test";
import { EditorState } from "@codemirror/state";
import type { WidgetType } from "@codemirror/view";
import { parseMarkdown } from "../../../src/markdown/dialect";
import type {
  BlockRenderer,
  InlineRenderer,
} from "../../../src/plugins/livePreview/api";
import {
  blockIndex,
  refreshRender,
  renderRevision,
} from "../../../src/plugins/livePreview/blocks";
import {
  documentTree,
  replaceDocumentTree,
} from "../../../src/plugins/livePreview/document-tree";
import { blockRenderers } from "../../../src/plugins/livePreview/registry";
import {
  blockDecorations,
  blockViewportSupport,
} from "../../../src/plugins/livePreview/viewport-decorations";
import { embedsWebview } from "../../../src/plugins/embeds/webview";
import { onlineVideosWebview } from "../../../src/plugins/onlineVideos/webview";

const TWEET = "![](https://x.com/jack/status/20)";
const CARD = 48 + 16;
const FRAME = 400 + 16;

/**
 * Embeds applied to a stand-in context. `claim` is what Online Videos would
 * answer to `render/claimedHeight` (`answer`, when set, answers instead), which
 * it stops answering when it is switched off.
 */
function embedsWithClaim() {
  const state = {
    claim: undefined as number | undefined,
    answer: undefined as ((target: string) => number | undefined) | undefined,
    asked: [] as string[],
  };
  const blocks: BlockRenderer[] = [];
  const inlines: InlineRenderer[] = [];
  const ctx = {
    render: { trusted: true },
    resources: {},
    rpc: { call: async () => true },
    logger: { warn() {} },
    commands: { register: () => () => {} },
    editor: { extend: () => () => {} },
    livePreview: {
      block(renderer: BlockRenderer) {
        blocks.push(renderer);
        return () => {};
      },
      inline(renderer: InlineRenderer) {
        inlines.push(renderer);
        return () => {};
      },
    },
    effect(register: () => unknown) {
      register();
    },
    on() {},
    bail(event: string, target: string) {
      assert.equal(event, "render/claimedHeight");
      state.asked.push(target);
      return state.answer ? state.answer(target) : state.claim;
    },
  };
  void embedsWebview.apply(ctx as never, undefined as never);
  return { state, blocks, inline: inlines[0]!, textBlock: blocks[0]! };
}

/** The inline widget Embeds draws for a source, by the renderer's own `decorate`. */
function inlineWidget(
  embeds: ReturnType<typeof embedsWithClaim>,
  source: string,
) {
  const widgets: WidgetType[] = [];
  embeds.inline.decorate(
    { from: 0, to: source.length, name: "Image" } as never,
    {
      state: { sliceDoc: () => source },
      revealed: () => false,
      replace: (_from: number, _to: number, widget: WidgetType) =>
        widgets.push(widget),
    } as never,
  );
  assert.equal(widgets.length, 1);
  return widgets[0]! as WidgetType & { estimatedHeight: number };
}

test("an inline tweet link is drawn again when Online Videos is switched off", () => {
  const embeds = embedsWithClaim();
  embeds.state.claim = 400;
  const whileOn = inlineWidget(embeds, TWEET);
  embeds.state.claim = undefined;
  const afterOff = inlineWidget(embeds, TWEET);
  // CodeMirror keeps the DOM of a widget that compares equal: the one drawn
  // while the plugin ran now holds a bare image nobody draws.
  assert.equal(whileOn.eq(afterOff), false);
  assert.equal(afterOff.eq(inlineWidget(embeds, TWEET)), true);
});

test("an inline tweet link is drawn again when Online Videos is switched on", () => {
  const embeds = embedsWithClaim();
  const whileOff = inlineWidget(embeds, TWEET);
  embeds.state.claim = 400;
  assert.equal(whileOff.eq(inlineWidget(embeds, TWEET)), false);
});

test("an inline widget reserves the claimed height, and the card's when none is claimed", () => {
  const embeds = embedsWithClaim();
  embeds.state.claim = 400;
  assert.equal(inlineWidget(embeds, TWEET).estimatedHeight, FRAME);
  embeds.state.claim = undefined;
  assert.equal(inlineWidget(embeds, TWEET).estimatedHeight, CARD);
});

test("only a web address is asked about, so local embeds cost nothing", () => {
  const embeds = embedsWithClaim();
  for (const source of [
    "![[Note]]",
    "![[doc.pdf]]",
    "![[Note#Heading|alias]]",
  ]) {
    inlineWidget(embeds, source);
  }
  assert.deepEqual(embeds.state.asked, []);
  inlineWidget(embeds, TWEET);
  assert.deepEqual(embeds.state.asked, ["https://x.com/jack/status/20"]);
});

test("a block tweet link reserves the claimed height, and the card's when none is claimed", () => {
  const embeds = embedsWithClaim();
  const block = { kind: "embed", source: TWEET, markdown: TWEET } as never;
  const widget = embeds.textBlock.widget(block) as WidgetType & {
    estimatedHeight: number;
  };
  embeds.state.claim = 400;
  assert.equal(widget.estimatedHeight, FRAME);
  embeds.state.claim = undefined;
  assert.equal(widget.estimatedHeight, CARD);
});

test("control: a block tweet link is drawn again when rendering is refreshed", () => {
  // Blocks are redrawn by the render revision (`GuardedWidget`), which the
  // switch's `render/changed` bumps; inline widgets need the claim above.
  const embeds = embedsWithClaim();
  const decorations = blockDecorations(() => {});
  let state = EditorState.create({
    doc: `intro\n\n${TWEET}\n\nend`,
    extensions: [
      documentTree,
      renderRevision,
      blockIndex,
      ...blockViewportSupport,
      decorations,
      blockRenderers.of(embeds.textBlock),
    ],
  });
  state = state.update({
    effects: replaceDocumentTree.of(parseMarkdown(state.doc)),
  }).state;
  const widgetsOf = (current: EditorState) => {
    const found: WidgetType[] = [];
    current
      .field(decorations)
      .between(0, current.doc.length, (_f, _t, value) => {
        if (value.spec.widget) {
          found.push(value.spec.widget as WidgetType);
        }
      });
    return found;
  };
  const before = widgetsOf(state);
  assert.equal(before.length, 1);
  assert.equal(
    before[0]!.eq(widgetsOf(state)[0]!),
    true,
    "without a refresh the widget is kept",
  );
  const after = widgetsOf(
    state.update({ effects: refreshRender.of(null) }).state,
  );
  assert.equal(after.length, 1);
  assert.equal(before[0]!.eq(after[0]!), false);
});

/** What the real Online Videos plugin answers to `render/claimedHeight`. */
function onlineVideosAnswer(isTrusted: boolean) {
  let answer: ((target: string) => number | undefined) | undefined;
  const ctx = {
    render: { trusted: isTrusted },
    rpc: {},
    logger: {},
    effect() {},
    on(event: string, handler: (target: string) => number | undefined) {
      if (event === "render/claimedHeight") {
        answer = handler;
      }
    },
  };
  void onlineVideosWebview.apply(ctx as never, undefined as never);
  assert.ok(answer);
  return answer;
}

for (const [mode, isTrusted, height] of [
  ["a trusted workspace", true, 400],
  ["an untrusted workspace", false, 112],
] as const) {
  test(`Online Videos switched off and on again redraws an inline tweet link in ${mode}`, () => {
    const embeds = embedsWithClaim();
    const running = onlineVideosAnswer(isTrusted);
    embeds.state.answer = running;
    const whileOn = inlineWidget(embeds, TWEET);
    // The height reserved is what is drawn: the frame, or the card.
    assert.equal(whileOn.estimatedHeight, height + 16);
    // Switched off: nobody answers.
    embeds.state.answer = () => undefined;
    const afterOff = inlineWidget(embeds, TWEET);
    assert.equal(afterOff.estimatedHeight, CARD);
    assert.equal(whileOn.eq(afterOff), false, "switched off");
    // Switched on again.
    embeds.state.answer = running;
    assert.equal(
      afterOff.eq(inlineWidget(embeds, TWEET)),
      false,
      "switched on",
    );
    assert.equal(whileOn.eq(inlineWidget(embeds, TWEET)), true, "unchanged");
  });
}
