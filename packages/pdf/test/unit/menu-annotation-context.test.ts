import assert from "node:assert/strict";
import { test } from "node:test";
import { followMenuContext, menuContext } from "../../src/webview/menu-context";

test("menuContext reports both selection and annotation-selection keys", () => {
  assert.equal(
    menuContext({
      hasSelection: true,
      hasTextSelection: true,
      hasAnnotationSelection: false,
    }),
    '{"lumiere.pdf.hasSelection":true,"lumiere.pdf.hasTextSelection":true,"lumiere.pdf.hasAnnotationSelection":false}',
  );
  assert.equal(
    menuContext({
      hasSelection: true,
      hasTextSelection: false,
      hasAnnotationSelection: true,
    }),
    '{"lumiere.pdf.hasSelection":true,"lumiere.pdf.hasTextSelection":false,"lumiere.pdf.hasAnnotationSelection":true}',
  );
});

test("followMenuContext writes annotation selection for Delete gating", () => {
  const attributes: Record<string, string> = {};
  const listeners: {
    type: string;
    listener: () => void;
    capture?: boolean;
  }[] = [];
  const doc = {
    body: {
      setAttribute: (name: string, value: string) => {
        attributes[name] = value;
      },
    },
    addEventListener: (
      type: string,
      listener: () => void,
      capture?: boolean,
    ) => {
      listeners.push({ type, listener, capture: Boolean(capture) });
    },
    removeEventListener: (type: string, listener: () => void) => {
      const index = listeners.findIndex(
        (entry) => entry.type === type && entry.listener === listener,
      );
      listeners.splice(index, 1);
    },
  };
  let state = {
    hasSelection: false,
    hasTextSelection: false,
    hasAnnotationSelection: false,
  };
  const stop = followMenuContext(doc as never, () => state);
  state = {
    hasSelection: true,
    hasTextSelection: true,
    hasAnnotationSelection: false,
  };
  listeners[0]!.listener();
  assert.equal(
    attributes["data-vscode-context"],
    '{"lumiere.pdf.hasSelection":true,"lumiere.pdf.hasTextSelection":true,"lumiere.pdf.hasAnnotationSelection":false}',
  );
  state = {
    hasSelection: true,
    hasTextSelection: false,
    hasAnnotationSelection: true,
  };
  listeners[0]!.listener();
  assert.equal(
    attributes["data-vscode-context"],
    '{"lumiere.pdf.hasSelection":true,"lumiere.pdf.hasTextSelection":false,"lumiere.pdf.hasAnnotationSelection":true}',
  );
  stop();
});
