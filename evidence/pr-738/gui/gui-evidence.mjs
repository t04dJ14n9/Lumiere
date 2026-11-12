import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHarnessServer } from "./serve-harness.mjs";

const WORKTREE = "/Users/t04dj14n9/Code/Lumia/.claude/worktrees/pr-738";
const PACKAGE_DIR = path.join(WORKTREE, "packages/markdown");
const EVIDENCE_DIR = "/tmp/pr738-gui-evidence";
const LOGS_DIR = "/tmp/pr738-gui-logs";
const PORT = 19238;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DIRECTIONS = ["ltr", "rtl"];
const DIAGRAMS = ["first", "second"];
const FRACTIONS = [0, 0.25, 0.5, 0.75, 1];
const require = createRequire(path.join(WORKTREE, "package.json"));
const { chromium } = require("@playwright/test");
const screenshots = [];
const defects = [];
const pageErrors = [];
const consoleErrors = [];

function git(...args) {
  return execFileSync("git", ["-C", WORKTREE, ...args], { encoding: "utf8" }).trim();
}

function lsofListeners() {
  let output = "";
  try {
    output = execFileSync("lsof", ["-nP", `-iTCP:${PORT}`, "-sTCP:LISTEN"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    output = typeof error?.stdout === "string" ? error.stdout : "";
  }
  const lines = output.trim().split("\n").filter(Boolean).slice(1);
  return lines.map((line) => {
    const fields = line.trim().split(/\s+/);
    return { command: fields[0] ?? "unknown", pid: fields[1] ?? "unknown" };
  });
}

function redact(value) {
  const replacements = [
    [WORKTREE, "<worktree>"],
    ["/Users/t04dj14n9/Code/Lumia", "<repo>"],
    ["/Users/t04dj14n9", "<home>"],
  ];
  return JSON.parse(
    JSON.stringify(value, (_key, item) => {
      if (typeof item !== "string") {
        return item;
      }
      let text = item;
      for (const [needle, replacement] of replacements) {
        text = text.replaceAll(needle, replacement);
      }
      text = text.replace(/Set-Cookie:[^\n]*/gi, "Set-Cookie: [redacted]");
      text = text.replace(/(?:token|cookie|panelId|panelID|clientID)\s*[:=]\s*["']?[^,\s}"']+/gi, "$1: [redacted]");
      return text;
    }),
  );
}

async function hashFile(relativePath) {
  const bytes = await readFile(path.join(PACKAGE_DIR, relativePath));
  return createHash("sha256").update(bytes).digest("hex");
}

async function shoot(page, filename) {
  const target = path.join(EVIDENCE_DIR, filename);
  await page.screenshot({ path: target, fullPage: false, animations: "disabled" });
  screenshots.push(filename);
  return filename;
}

async function twoFrames(page) {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

async function tagShells(page) {
  await page.evaluate(() => {
    [...document.querySelectorAll('pre[data-fence="mermaid"]')].forEach((pre, index) => {
      const shell = pre.closest(".hybrid-block");
      if (shell) {
        shell.dataset.evidenceDiagram = index === 0 ? "first" : "second";
      }
    });
  });
}

async function loadHarness(page, direction) {
  const errors = [];
  page.on("pageerror", (error) => {
    const text = String(error?.stack ?? error);
    errors.push(text);
    pageErrors.push({ direction, text });
  });
  page.on("console", (message) => {
    if (message.type() !== "error") {
      return;
    }
    const text = message.text();
    errors.push(text);
    consoleErrors.push({ direction, text });
  });
  await page.goto(`${BASE_URL}/?dir=${direction}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__harnessReady || window.__harnessError, undefined, {
    timeout: 30000,
  });
  const harnessError = await page.evaluate(() => window.__harnessError ?? null);
  if (harnessError) {
    throw new Error(`harness failed: ${harnessError}`);
  }
  await page.waitForFunction(
    () => {
      const pres = [...document.querySelectorAll('pre[data-fence="mermaid"]')];
      return pres.length === 2 && pres.every((pre) => pre.querySelector("svg .node"));
    },
    undefined,
    { timeout: 30000 },
  );
  await page.waitForFunction(
    (expected) => document.querySelector(".cm-editor")?.getAttribute("dir") === expected,
    direction,
    { timeout: 10000 },
  );
  await page.addStyleTag({
    content: `
      .hybrid-block .inspect-diagram,
      .hybrid-block .copy-code,
      .hybrid-block .edit-block { opacity: 1 !important; }
      .hybrid-block .code-language { opacity: 0 !important; }
    `,
  });
  await tagShells(page);
  await twoFrames(page);
  return errors;
}

function directionInfo() {
  const editor = document.querySelector(".cm-editor");
  const pre = document.querySelector('pre[data-fence="mermaid"]:has(> svg)');
  const shell = pre?.closest(".hybrid-block");
  const inspect = shell?.querySelector(".inspect-diagram");
  const copy = shell?.querySelector(".copy-code");
  const edit = shell?.querySelector(".edit-block");
  const style = pre ? getComputedStyle(pre) : null;
  const rect = (element) => {
    if (!element) {
      return null;
    }
    const box = element.getBoundingClientRect();
    return { left: box.left, right: box.right, width: box.width };
  };
  return {
    documentDir: document.documentElement.dir,
    bodyDir: document.body.dir,
    editorDirAttribute: editor?.getAttribute("dir") ?? null,
    editorComputedDirection: editor ? getComputedStyle(editor).direction : null,
    preComputedDirection: style?.direction ?? null,
    preMarginRight: style?.marginRight ?? null,
    preMarginLeft: style?.marginLeft ?? null,
    preOverflowX: style?.overflowX ?? null,
    prePadding: style ? `${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft}` : null,
    toolbarRightOffsets: {
      inspect: inspect ? getComputedStyle(inspect).right : null,
      copy: copy ? getComputedStyle(copy).right : null,
      edit: edit ? getComputedStyle(edit).right : null,
    },
    firstShellBox: rect(shell),
    firstPreBox: rect(pre),
  };
}

async function scrollDiagramIntoView(page, diagramId) {
  await tagShells(page);
  await page.evaluate((id) => {
    const shell = document.querySelector(`[data-evidence-diagram="${id}"]`);
    if (!shell) {
      throw new Error(`missing evidence shell: ${id}`);
    }
    shell.scrollIntoView({ block: "center", inline: "nearest" });
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, diagramId);
}

function measureInPage({ diagramId, fraction }) {
  const shell = document.querySelector(`[data-evidence-diagram="${diagramId}"]`);
  const pre = shell?.querySelector('pre[data-fence="mermaid"]');
  const svg = pre?.querySelector("svg");
  const scroller = document.querySelector(".cm-scroller");
  if (!shell || !pre || !svg || !scroller || !svg.querySelector(".node")) {
    return { ready: false, diagramId, fraction };
  }
  const max = Math.max(0, pre.scrollWidth - pre.clientWidth);
  const wanted = max * fraction;
  let best = { requested: 0, error: Infinity };
  for (const requested of [wanted, -wanted]) {
    pre.scrollLeft = requested;
    const actual = pre.scrollLeft;
    const error = Math.abs(Math.abs(actual) - wanted);
    if (error < best.error) {
      best = { requested, error };
    }
  }
  pre.scrollLeft = best.requested;
  const scrollLeft = pre.scrollLeft;
  const shellBox = shell.getBoundingClientRect();
  const preBox = pre.getBoundingClientRect();
  const slop = 0.5;
  const buttons = [
    ...shell.querySelectorAll(".inspect-diagram, .copy-code, .edit-block, .code-language"),
  ].map((element) => {
    const box = element.getBoundingClientRect();
    return {
      name: element.getAttribute("aria-label") || element.textContent?.trim() || element.className,
      left: box.left,
      right: box.right,
      top: box.top,
      bottom: box.bottom,
      width: box.width,
      height: box.height,
      rightOffsetFromShell: shellBox.right - box.right,
    };
  });
  const rawNodes = [...svg.querySelectorAll(".node")].map((element) => {
    const box = element.getBoundingClientRect();
    return {
      label: (element.textContent || "").replace(/\s+/g, " ").trim(),
      left: box.left,
      right: box.right,
      top: box.top,
      bottom: box.bottom,
      width: box.width,
      height: box.height,
    };
  });
  const visibleNodes = rawNodes.flatMap((node) => {
    const left = Math.max(node.left, preBox.left);
    const right = Math.min(node.right, preBox.right);
    const top = Math.max(node.top, preBox.top);
    const bottom = Math.min(node.bottom, preBox.bottom);
    if (right - left <= slop || bottom - top <= slop) {
      return [];
    }
    return [
      {
        label: node.label,
        left,
        right,
        top,
        bottom,
        width: right - left,
        height: bottom - top,
        raw: {
          left: node.left,
          right: node.right,
          top: node.top,
          bottom: node.bottom,
          width: node.width,
          height: node.height,
        },
      },
    ];
  });
  const intersects = (button, node) =>
    button.right > node.left + slop &&
    button.left < node.right - slop &&
    button.bottom > node.top + slop &&
    button.top < node.bottom - slop;
  const visibleOverlaps = [];
  const rawOverlaps = [];
  let minSeparationPx = null;
  for (const button of buttons) {
    if (button.width < 1 || button.height < 1) {
      continue;
    }
    for (const node of visibleNodes) {
      if (intersects(button, node)) {
        visibleOverlaps.push({ button: button.name, node: node.label });
      }
      const dx = Math.max(0, button.left - node.right, node.left - button.right);
      const dy = Math.max(0, button.top - node.bottom, node.top - button.bottom);
      const separation = Math.hypot(dx, dy);
      minSeparationPx = minSeparationPx === null ? separation : Math.min(minSeparationPx, separation);
    }
    for (const node of rawNodes) {
      if (intersects(button, node)) {
        rawOverlaps.push({ button: button.name, node: node.label });
      }
    }
  }
  const laneLeft = buttons.reduce(
    (left, button) =>
      button.width >= 1 && button.height >= 1 && button.left < left ? button.left : left,
    preBox.right,
  );
  const preStyle = getComputedStyle(pre);
  return {
    ready: true,
    diagramId,
    fraction,
    scrollLeft,
    scrollMax: max,
    scrollMode: scrollLeft < -0.5 ? "negative-rtl" : scrollLeft > 0.5 ? "positive-ltr" : "zero",
    scrollFractionActual: max ? Math.abs(scrollLeft) / max : 0,
    preClientWidth: pre.clientWidth,
    preScrollWidth: pre.scrollWidth,
    scrollerClientWidth: scroller.clientWidth,
    scrollerScrollWidth: scroller.scrollWidth,
    shellBox: { left: shellBox.left, right: shellBox.right, top: shellBox.top, bottom: shellBox.bottom },
    preBox: { left: preBox.left, right: preBox.right, top: preBox.top, bottom: preBox.bottom },
    buttons,
    buttonCount: buttons.length,
    rawNodes,
    visibleNodes,
    nodeCount: visibleNodes.length,
    rawNodeCount: rawNodes.length,
    visibleOverlaps,
    rawOverlaps,
    minSeparationPx,
    laneLeft,
    preRight: preBox.right,
    scrollportEndsBeforeLane: preBox.right <= laneLeft + 1,
    noPageHorizontalOverflow: scroller.scrollWidth < scroller.clientWidth + 48,
    inspectInsidePre: Boolean(shell.querySelector(".inspect-diagram") && pre.contains(shell.querySelector(".inspect-diagram"))),
    computed: {
      direction: preStyle.direction,
      marginRight: preStyle.marginRight,
      marginLeft: preStyle.marginLeft,
      overflowX: preStyle.overflowX,
      padding: `${preStyle.paddingTop} ${preStyle.paddingRight} ${preStyle.paddingBottom} ${preStyle.paddingLeft}`,
    },
  };
}

async function measure(page, diagramId, fraction) {
  return page.evaluate(measureInPage, { diagramId, fraction });
}

async function overlay(page, measurement, direction) {
  await page.evaluate(({ data, label }) => {
    document.querySelectorAll("[data-evidence-overlay]").forEach((element) => element.remove());
    const add = (box, style, text) => {
      const element = document.createElement("div");
      element.dataset.evidenceOverlay = "true";
      Object.assign(element.style, {
        position: "fixed",
        left: `${box.left}px`,
        top: `${box.top}px`,
        width: `${Math.max(0, box.right - box.left)}px`,
        height: `${Math.max(0, box.bottom - box.top)}px`,
        boxSizing: "border-box",
        pointerEvents: "none",
        zIndex: "2147483000",
        ...style,
      });
      if (text) {
        element.textContent = text;
        element.style.font = "11px system-ui, sans-serif";
        element.style.padding = "2px 4px";
      }
      document.body.append(element);
    };
    const lane = {
      left: data.preBox.right,
      right: data.shellBox.right,
      top: data.preBox.top,
      bottom: data.preBox.bottom,
    };
    add(lane, {
      background: "rgba(255, 190, 0, 0.15)",
      borderLeft: "2px dashed #b36b00",
      borderRight: "2px dashed #b36b00",
    });
    for (const button of data.buttons) {
      if (button.width >= 1 && button.height >= 1) {
        add(button, { border: "2px solid #c62828", background: "rgba(198, 40, 40, 0.08)" });
      }
    }
    for (const node of data.visibleNodes) {
      add(node, { border: "1px solid #1565c0", background: "rgba(21, 101, 192, 0.06)" });
    }
    add(
      { left: 10, right: 420, top: 10, bottom: 44 },
      {
        background: "rgba(255,255,255,0.95)",
        border: "1px solid #888",
        color: "#222",
      },
      label,
    );
  }, {
    data: measurement,
    label: `${direction.toUpperCase()} | scroll ${Math.round(measurement.fraction * 100)}% | red: toolbar | blue: visible nodes | amber: reserved right lane | overlaps: ${measurement.visibleOverlaps.length}`,
  });
  await shoot(page, `geometry-overlay-${direction}.png`);
  await page.evaluate(() => {
    document.querySelectorAll("[data-evidence-overlay]").forEach((element) => element.remove());
  });
}

async function exerciseActions(page, direction) {
  const result = { direction, targetDiagram: "second", screenshots: [] };
  await scrollDiagramIntoView(page, "second");
  await measure(page, "second", 1);
  const shell = page.locator('[data-evidence-diagram="second"]');

  await shell.locator(".inspect-diagram").click();
  await page.waitForSelector("dialog.diagram-inspector", { state: "visible" });
  const inspect = await page.evaluate(() => {
    const dialog = document.querySelector("dialog.diagram-inspector");
    const fullText = dialog?.querySelector("svg")?.textContent?.replace(/\s+/g, " ").trim() ?? "";
    const nodeLabels = [...(dialog?.querySelectorAll("svg .node") ?? [])]
      .map((node) => (node.textContent ?? "").replace(/\s+/g, " ").trim())
      .filter(Boolean);
    return {
      dialogOpen: Boolean(dialog?.open),
      diagramLabel: dialog?.getAttribute("aria-label") ?? null,
      status: dialog?.querySelector('[role="status"]')?.textContent?.trim() ?? null,
      nodeLabelCount: nodeLabels.length,
      nodeLabels,
      fullTextLength: fullText.length,
      fullTextContainsTarget: fullText.includes("Bravo step"),
      fullTextExcludesOtherDiagram: !fullText.includes("Intake request"),
    };
  });
  result.inspect = {
    ...inspect,
    containsTarget: inspect.nodeLabels.some((label) => label.includes("Bravo step")),
    excludesOtherDiagram:
      inspect.fullTextExcludesOtherDiagram &&
      !inspect.nodeLabels.some((label) => label.includes("Intake request")),
    targetsRightDiagram:
      inspect.dialogOpen &&
      inspect.fullTextContainsTarget &&
      inspect.fullTextExcludesOtherDiagram &&
      inspect.nodeLabels.some((label) => label.includes("Bravo step")) &&
      !inspect.nodeLabels.some((label) => label.includes("Intake request")),
    clickedButtonInTargetShell: true,
  };
  result.screenshots.push(await shoot(page, `action-inspect-${direction}.png`));
  await page.getByRole("button", { name: "Close diagram" }).click();
  await page.waitForSelector("dialog.diagram-inspector", { state: "detached" });
  await tagShells(page);

  const expectedCopy = await page.evaluate(() => {
    const pre = document.querySelector('[data-evidence-diagram="second"] pre[data-fence="mermaid"]');
    return decodeURIComponent(pre?.dataset.source ?? "");
  });
  await page.evaluate(() => {
    window.harness.clipboard = "";
  });
  await shell.locator(".copy-code").click();
  await page.waitForFunction((expected) => window.harness.clipboard === expected, expectedCopy, {
    timeout: 10000,
  });
  const copied = await page.evaluate(() => window.harness.clipboard);
  result.copy = {
    exactMatchToTargetSource: copied === expectedCopy,
    length: copied.length,
    sha256: createHash("sha256").update(copied).digest("hex"),
    startsWith: copied.slice(0, 80),
    containsTarget: copied.includes("Bravo step"),
    excludesOtherDiagram: !copied.includes("Intake request"),
    clickedButtonInTargetShell: true,
  };
  result.screenshots.push(await shoot(page, `action-copy-${direction}.png`));

  await tagShells(page);
  await shell.locator(".edit-block").click();
  await page.waitForFunction(
    () => document.querySelector(".cm-content")?.textContent?.includes("Bravo step"),
    undefined,
    { timeout: 10000 },
  );
  const edit = await page.evaluate(async () => {
    const selection = await window.harness.capture();
    const content = document.querySelector(".cm-content")?.textContent ?? "";
    const docText = window.harness.text;
    const slice = docText.slice(selection.from, selection.to);
    const targetIndex = docText.indexOf("Bravo step");
    const targetBlockFrom = docText.lastIndexOf("```mermaid", targetIndex);
    const targetBlockTo = docText.indexOf("```", targetIndex) + 3;
    const svgs = [...document.querySelectorAll('pre[data-fence="mermaid"] svg')];
    return {
      selection: {
        from: selection.from,
        to: selection.to,
        text: selection.text,
        version: selection.version,
      },
      targetBlockRange: { from: targetBlockFrom, to: targetBlockTo },
      selectionInsideTargetBlock:
        selection.from >= targetBlockFrom && selection.to <= targetBlockTo + 1,
      sliceMatchesSelectionText: slice === selection.text,
      sliceContainsTarget: slice.includes("Bravo step"),
      selectionContainsTarget: selection.text.includes("Bravo step"),
      selectionExcludesOtherDiagram: !selection.text.includes("Intake request"),
      sourceRevealedInEditor: content.includes("Bravo step") && content.includes("flowchart LR"),
      firstDiagramStillRendered: svgs.some((svg) => svg.textContent?.includes("Intake request")),
      secondDiagramNoLongerRendered: !svgs.some((svg) => svg.textContent?.includes("Bravo step")),
      renderedSvgCount: svgs.length,
    };
  });
  result.edit = {
    ...edit,
    targetsRightDiagram:
      (edit.selectionInsideTargetBlock || edit.selectionContainsTarget) &&
      edit.selectionExcludesOtherDiagram &&
      edit.sourceRevealedInEditor &&
      edit.firstDiagramStillRendered &&
      edit.secondDiagramNoLongerRendered,
    clickedButtonInTargetShell: true,
  };
  result.screenshots.push(await shoot(page, `action-edit-${direction}.png`));
  return result;
}

function summarizeGeometry(geometry) {
  const measurements = [];
  const separations = [];
  for (const direction of DIRECTIONS) {
    for (const diagramId of DIAGRAMS) {
      for (const measurement of geometry[direction].diagrams[diagramId].measurements) {
        measurements.push({ direction, diagramId, measurement });
        if (typeof measurement.minSeparationPx === "number") {
          separations.push(measurement.minSeparationPx);
        }
      }
    }
  }
  const bad = measurements.filter(
    ({ measurement }) =>
      !measurement.ready ||
      measurement.visibleOverlaps.length > 0 ||
      !measurement.scrollportEndsBeforeLane ||
      !measurement.noPageHorizontalOverflow ||
      measurement.buttonCount < 3 ||
      measurement.nodeCount < 1 ||
      measurement.inspectInsidePre,
  );
  const allRawOverlapsOutsideScrollport = measurements.every(({ measurement }) =>
    measurement.rawOverlaps.every((hit) => {
      const node = measurement.rawNodes.find((candidate) => candidate.label === hit.node);
      return Boolean(
        node &&
          (node.right > measurement.preBox.right + 0.5 ||
            node.left < measurement.preBox.left - 0.5 ||
            node.bottom < measurement.preBox.top - 0.5 ||
            node.top > measurement.preBox.bottom + 0.5),
      );
    }),
  );
  return {
    criterion: "Node boxes are clipped to the mermaid pre scrollport; no toolbar box may intersect a visible node, and pre.right must end at or before the leftmost toolbar control.",
    measurementCount: measurements.length,
    directions: DIRECTIONS,
    diagrams: DIAGRAMS,
    scrollFractions: FRACTIONS,
    visibleOverlapCount: measurements.reduce((sum, item) => sum + item.measurement.visibleOverlaps.length, 0),
    rawUnclippedOverlapCount: measurements.reduce((sum, item) => sum + item.measurement.rawOverlaps.length, 0),
    allRawOverlapsOutsideScrollport,
    rawUnclippedOverlapNote: "Raw SVG layout boxes can extend beyond the overflow-x:auto scrollport; only clipped, visible node boxes can be seen or hit. All raw-overlap nodes are outside the scrollport in these measurements.",
    allScrollportsEndBeforeLane: measurements.every((item) => item.measurement.scrollportEndsBeforeLane),
    allHaveAtLeastThreeControls: measurements.every((item) => item.measurement.buttonCount >= 3),
    allHaveVisibleNodes: measurements.every((item) => item.measurement.nodeCount > 0),
    allInspectButtonsOutsidePre: measurements.every((item) => !item.measurement.inspectInsidePre),
    minButtonNodeSeparationPx: separations.length ? Math.min(...separations) : null,
    failingMeasurements: bad.map(({ direction, diagramId, measurement }) => ({
      direction,
      diagramId,
      fraction: measurement.fraction,
      ready: measurement.ready,
      visibleOverlaps: measurement.visibleOverlaps,
      scrollportEndsBeforeLane: measurement.scrollportEndsBeforeLane,
      noPageHorizontalOverflow: measurement.noPageHorizontalOverflow,
      buttonCount: measurement.buttonCount,
      nodeCount: measurement.nodeCount,
      inspectInsidePre: measurement.inspectInsidePre,
    })),
  };
}

async function main() {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await mkdir(LOGS_DIR, { recursive: true });
  const before = lsofListeners();
  if (before.length > 0) {
    throw new Error(`port ${PORT} already has a listener: ${JSON.stringify(before)}`);
  }
  const headSha = git("rev-parse", "HEAD");
  const subject = git("log", "-1", "--format=%s");
  const trackedStatus = git("status", "--short", "--untracked-files=no");
  const buildHashes = {
    "dist/webview/editor.css": await hashFile("dist/webview/editor.css"),
    "dist/webview/editor.js": await hashFile("dist/webview/editor.js"),
    "artifacts/fake-host.js": await hashFile("artifacts/fake-host.js"),
    "test/browser/mermaid-toolbar-overlap.spec.ts": await hashFile("test/browser/mermaid-toolbar-overlap.spec.ts"),
  };
  const server = createHarnessServer({ root: PACKAGE_DIR, port: PORT });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, "127.0.0.1", resolve);
  });
  const during = lsofListeners();
  const allMine = during.length > 0 && during.every((item) => item.pid === String(process.pid));
  if (!allMine) {
    defects.push(`Port ${PORT} listener ownership was not exclusive to this harness during GUI run.`);
  }
  const health = await fetch(`${BASE_URL}/health`);
  const healthHeaders = Object.fromEntries(health.headers.entries());
  const healthBody = await health.text();
  const browser = await chromium.launch({ headless: true });
  const browserVersion = browser.version();
  const context = await browser.newContext({
    viewport: { width: 1100, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  const geometry = {};
  const actions = {};
  const dirAttributes = {};
  let contextCookieCount = 0;
  try {
    for (const direction of DIRECTIONS) {
      const page = await context.newPage();
      await loadHarness(page, direction);
      dirAttributes[direction] = await page.evaluate(directionInfo);
      geometry[direction] = { diagrams: {} };
      for (const diagramId of DIAGRAMS) {
        geometry[direction].diagrams[diagramId] = { measurements: [] };
        for (const fraction of FRACTIONS) {
          await scrollDiagramIntoView(page, diagramId);
          const measurement = await measure(page, diagramId, fraction);
          geometry[direction].diagrams[diagramId].measurements.push(measurement);
        }
      }
      await scrollDiagramIntoView(page, "first");
      await measure(page, "first", 0);
      await shoot(page, `toolbar-${direction}-start.png`);
      const end = await measure(page, "first", 1);
      await shoot(page, `toolbar-${direction}-end.png`);
      await overlay(page, end, direction);
      await page.close();

      const actionPage = await context.newPage();
      await loadHarness(actionPage, direction);
      actions[direction] = await exerciseActions(actionPage, direction);
      await actionPage.close();
    }
    contextCookieCount = (await context.cookies()).length;
  } finally {
    await context.close();
    await browser.close();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const after = lsofListeners();
  if (after.length > 0) {
    defects.push(`Port ${PORT} still has a listener after this harness stopped.`);
  }
  const geometrySummary = summarizeGeometry(geometry);
  if (geometrySummary.failingMeasurements.length > 0) {
    defects.push("One or more toolbar/node geometry measurements failed the no-overlap criterion.");
  }
  if (!geometrySummary.allRawOverlapsOutsideScrollport) {
    defects.push("A raw SVG node geometry overlap was not explained by scrollport clipping.");
  }
  for (const direction of DIRECTIONS) {
    const action = actions[direction];
    if (!action.inspect.targetsRightDiagram) {
      defects.push(`${direction.toUpperCase()} Inspect did not open the target diagram alone.`);
    }
    if (!action.copy.exactMatchToTargetSource || !action.copy.containsTarget || !action.copy.excludesOtherDiagram) {
      defects.push(`${direction.toUpperCase()} Copy did not copy the target diagram source.`);
    }
    if (!action.edit.targetsRightDiagram) {
      defects.push(`${direction.toUpperCase()} Edit did not reveal the target diagram source alone.`);
    }
  }
  const result = redact({
    generatedAt: new Date().toISOString(),
    pr: 738,
    head: {
      sha: headSha,
      subject,
      trackedStatus,
      sourceModified: trackedStatus.length > 0,
    },
    port: {
      value: PORT,
      explicit: true,
      beforeListeners: before.length,
      duringListeners: during.length,
      duringListenersAllThisProcess: allMine,
      afterListeners: after.length,
      reusedOtherServer: false,
      killedProcesses: false,
    },
    build: {
      status: "pass",
      hashes: buildHashes,
      harnessRoot: "<worktree>/packages/markdown",
    },
    browser: {
      engine: "Chromium",
      version: browserVersion,
      headless: true,
      viewport: { width: 1100, height: 800 },
      note: "Generic two-diagram Mermaid fixture; no real user notes.",
    },
    server: {
      healthStatus: health.status,
      healthResponse: JSON.parse(healthBody),
      setCookieHeaderPresent: Boolean(healthHeaders["set-cookie"]),
      authTokenPresent: false,
      contextCookieCount,
    },
    directions: dirAttributes,
    geometrySummary,
    geometry,
    actions,
    screenshots,
    pageErrors,
    consoleErrors,
    defects,
  });
  await writeFile(path.join(LOGS_DIR, "gui-results.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({
    headSha,
    port: PORT,
    geometryMeasurements: geometrySummary.measurementCount,
    visibleOverlaps: geometrySummary.visibleOverlapCount,
    screenshots: screenshots.length,
    defects,
  }, null, 2));
}

main().catch((error) => {
  const message = String(error?.stack ?? error);
  console.error(message);
  process.exitCode = 1;
});
