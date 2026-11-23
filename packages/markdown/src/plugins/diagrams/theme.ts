import type { MermaidConfig } from "mermaid";

/** Editor-derived defaults only: Mermaid still owns authored class/style rules. */
export interface MermaidPalette {
  background: string;
  foreground: string;
  surface: string;
  /** A node's outline: clearly visible on its fill, quiet beside the text. */
  border: string;
  /** Lines that frame a diagram without carrying it (lifelines); the foreground in high contrast. */
  line: string;
  /** The editor's six chart colors, in an order whose neighbors differ. */
  chart: readonly string[];
  darkMode: boolean;
}

/** VS Code's chart colors with its own defaults, for a theme that sets none. */
const CHART_TOKENS: ReadonlyArray<readonly [string, string, string]> = [
  ["blue", "#3794ff", "#1a85ff"],
  ["orange", "#d18616", "#d18616"],
  ["green", "#89d185", "#388a34"],
  ["purple", "#b180d7", "#652d90"],
  ["red", "#f14c4c", "#e51400"],
  ["yellow", "#cca700", "#bf8803"],
];

function defaultDocument(): Document | undefined {
  return typeof document === "undefined" ? undefined : document;
}

function opaqueColor(value: string, fallback: string): string {
  const color = value.trim().toLowerCase();
  if (/^#[\da-f]{6}$/.test(color)) {
    return color;
  }
  if (/^#[\da-f]{3}$/.test(color)) {
    return `#${Array.from(color.slice(1), (digit) => digit + digit).join("")}`;
  }
  const rgb = color.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
  if (rgb && rgb.slice(1).every((channel) => Number(channel) <= 255)) {
    return `#${rgb
      .slice(1)
      .map((channel) => Number(channel).toString(16).padStart(2, "0"))
      .join("")}`;
  }
  // Unresolved/transparent tokens must not enter Mermaid's color arithmetic.
  return fallback;
}

function blend(background: string, foreground: string, amount: number): string {
  return `#${[1, 3, 5]
    .map((offset) => {
      const from = parseInt(background.slice(offset, offset + 2), 16);
      const to = parseInt(foreground.slice(offset, offset + 2), 16);
      return Math.round(from + (to - from) * amount)
        .toString(16)
        .padStart(2, "0");
    })
    .join("")}`;
}

/** Which of VS Code's theme kinds the body's classes name. */
function themeKind(body: HTMLElement | null | undefined) {
  const has = (name: string) => Boolean(body?.classList.contains(name));
  return {
    darkMode: has("vscode-dark") || has("vscode-high-contrast"),
    contrast: has("vscode-high-contrast") || has("vscode-high-contrast-light"),
  };
}

/**
 * The fill, outline and quiet line colors. A theme's own widget border is
 * often as faint as the fill, so outside high contrast the outline is mixed
 * from the editor colors, as the fill is.
 */
function outlines(
  colors: Pick<MermaidPalette, "background" | "foreground">,
  contrast: boolean,
  contrastBorder: string,
): Pick<MermaidPalette, "surface" | "border" | "line"> {
  const { background, foreground } = colors;
  if (contrast) {
    return { surface: background, border: contrastBorder, line: foreground };
  }
  return {
    surface: blend(background, foreground, 0.06),
    border: blend(background, foreground, 0.22),
    line: blend(background, foreground, 0.35),
  };
}

export function readMermaidPalette(doc = defaultDocument()): MermaidPalette {
  const body = doc?.body;
  const { darkMode, contrast } = themeKind(body);
  const style = body && doc?.defaultView?.getComputedStyle(body);
  const token = (name: string, fallback: string) =>
    opaqueColor(style?.getPropertyValue(name) ?? "", fallback);
  const background = token(
    "--vscode-editor-background",
    darkMode ? "#1e1e1e" : "#ffffff",
  );
  const foreground = token(
    "--vscode-editor-foreground",
    darkMode ? "#d4d4d4" : "#333333",
  );
  return {
    background,
    foreground,
    darkMode,
    chart: CHART_TOKENS.map(([name, dark, light]) =>
      token(`--vscode-charts-${name}`, darkMode ? dark : light),
    ),
    ...outlines(
      { background, foreground },
      contrast,
      token("--vscode-contrastBorder", blend(background, foreground, 0.5)),
    ),
  };
}

const surfaceVariables = [
  "primaryColor",
  "secondaryColor",
  "tertiaryColor",
  "mainBkg",
  "secondBkg",
  "nodeBkg",
  "clusterBkg",
  "actorBkg",
  "noteBkgColor",
  "activationBkgColor",
  "labelBoxBkgColor",
  "labelBackgroundColor",
  "stateBkg",
  "rectBkgColor",
  "taskBkgColor",
  "activeTaskBkgColor",
  "doneTaskBkgColor",
  "critBkgColor",
  "sectionBkgColor",
  "sectionBkgColor2",
  "altSectionBkgColor",
  "excludeBkgColor",
  "personBkg",
  "usecaseBkg",
  "usecaseActorBkg",
  "usecaseBoundaryBkg",
  "emCommandFill",
  "emEventFill",
  "emProcessorFill",
  "emReadModelFill",
  "attributeBackgroundColorOdd",
  "rowOdd",
  "edgeLabelBackground",
  "relationLabelBackground",
  "requirementBackground",
  "commitLabelBackground",
  "tagLabelBackground",
  "compositeTitleBackground",
  "emSwimlaneBackgroundOdd",
  "emUiFill",
];
const textVariables = [
  "primaryTextColor",
  "secondaryTextColor",
  "tertiaryTextColor",
  "textColor",
  "lineColor",
  "defaultLinkColor",
  "nodeTextColor",
  "labelColor",
  "labelTextColor",
  "titleColor",
  "classText",
  "actorTextColor",
  "signalColor",
  "signalTextColor",
  "loopTextColor",
  "noteTextColor",
  "transitionColor",
  "transitionLabelColor",
  "stateLabelColor",
  "specialStateColor",
  "relationColor",
  "relationLabelColor",
  "requirementTextColor",
  "arrowheadColor",
  "taskTextColor",
  "taskTextLightColor",
  "taskTextDarkColor",
  "taskTextOutsideColor",
  "taskTextClickableColor",
  "gridColor",
  "todayLineColor",
  "vertLineColor",
  "pieTitleTextColor",
  "pieSectionTextColor",
  "pieLegendTextColor",
  "rootLabelColor",
  "scaleLabelColor",
  "commitLabelColor",
  "commitLineColor",
  "tagLabelColor",
  "branchLabelColor",
  "vennSetTextColor",
  "vennTitleTextColor",
  "archEdgeColor",
  "archEdgeArrowColor",
  "quadrantTitleFill",
  "quadrantXAxisTextFill",
  "quadrantYAxisTextFill",
  "quadrantPointFill",
  "quadrantPointTextFill",
  "wardleyEvolutionColor",
  "emArrowhead",
  "emRelationStroke",
  "mainContrastColor",
  "darkTextColor",
];
const borderVariables = [
  "emUiStroke",
  "emProcessorStroke",
  "emReadModelStroke",
  "emCommandStroke",
  "emEventStroke",
  "emSwimlaneBackgroundStroke",
  "flowContainerStroke",
  "primaryBorderColor",
  "secondaryBorderColor",
  "tertiaryBorderColor",
  "nodeBorder",
  "clusterBorder",
  "actorBorder",
  "noteBorderColor",
  "activationBorderColor",
  "labelBoxBorderColor",
  "stateBorder",
  "compositeBorder",
  "requirementBorderColor",
  "taskBorderColor",
  "activeTaskBorderColor",
  "doneTaskBorderColor",
  "critBorderColor",
  "personBorder",
  "usecaseBorder",
  "usecaseActorBorder",
  "usecaseBoundaryBorder",
  "pieStrokeColor",
  "pieOuterStrokeColor",
  "tagLabelBorder",
  "archGroupBorderColor",
  "quadrantExternalBorderStrokeFill",
  "quadrantInternalBorderStrokeFill",
];

type ThemeVariables = Record<string, string | boolean | Record<string, string>>;

export function mermaidThemeVariables(palette: MermaidPalette): ThemeVariables {
  const variables: ThemeVariables = {
    background: palette.background,
    darkMode: palette.darkMode,
    fontFamily:
      "var(--font-mermaid, var(--vscode-editor-font-family, inherit))",
    useGradient: false,
    // Flat nodes: Mermaid's own default is an offset grey shadow.
    dropShadow: "none",
    attributeBackgroundColorEven: palette.background,
    rowEven: palette.background,
    compositeBackground: palette.background,
    sequenceNumberColor: palette.background,
  };
  for (const name of surfaceVariables) {
    variables[name] = palette.surface;
  }
  for (const name of textVariables) {
    variables[name] = palette.foreground;
  }
  for (const name of borderVariables) {
    variables[name] = palette.border;
  }
  // Lifelines are quieter than the messages that cross them.
  variables.actorLineColor = palette.line;
  addCategoryScales(variables, palette);
  addNestedPalettes(variables, palette);
  return variables;
}

/**
 * Twelve fills for categories (pie slices, Sankey nodes, color scales): the
 * editor's chart colors, eased toward the background so the editor's text
 * stays readable on them, then the same colors paler.
 */
export function categoryColors(palette: MermaidPalette): string[] {
  const strength = palette.darkMode ? 0.7 : 0.55;
  const fills = palette.chart.map((color) =>
    blend(palette.background, color, strength),
  );
  return [
    ...fills,
    ...fills.map((fill) => blend(palette.background, fill, 0.6)),
  ];
}

function addCategoryScales(
  variables: ThemeVariables,
  palette: MermaidPalette,
): void {
  // Neighboring categories must be told apart: a grayscale ladder was not.
  const colors = categoryColors(palette);
  for (let index = 0; index < 12; index++) {
    const shade = colors[index]!;
    variables[`pie${index + 1}`] = shade;
    variables[`cScale${index}`] = shade;
    variables[`cScaleLabel${index}`] = palette.foreground;
    variables[`cScalePeer${index}`] = shade;
    variables[`cScaleInv${index}`] = palette.foreground;
    variables[`git${index}`] = shade;
    variables[`gitInv${index}`] = palette.foreground;
    variables[`gitBranchLabel${index}`] = palette.foreground;
    variables[`fillType${index}`] = shade;
    variables[`surface${index}`] = shade;
    variables[`surfacePeer${index}`] = shade;
    variables[`venn${index + 1}`] = shade;
  }
  for (let index = 1; index <= 4; index++) {
    variables[`quadrant${index}Fill`] = palette.surface;
    variables[`quadrant${index}TextFill`] = palette.foreground;
  }
}

function addNestedPalettes(
  variables: ThemeVariables,
  palette: MermaidPalette,
): void {
  variables.xyChart = {
    plotColorPalette: Array.from({ length: 12 }, (_, index) =>
      String(variables[`cScale${index}`]),
    ).join(","),
  };
  variables.cynefin = {
    complexBg: palette.surface,
    complicatedBg: palette.surface,
    chaoticBg: palette.surface,
    clearBg: palette.surface,
    confusionBg: palette.surface,
    cliffColor: palette.foreground,
  };
  variables.radar = { graticuleColor: palette.border };
}

export function mermaidCacheKey(
  source: string,
  trusted: boolean,
  palette: MermaidPalette,
): string {
  return `${trusted ? "t" : "u"}|${JSON.stringify(palette)}|${source}`;
}

export function watchMermaidTheme(
  changed: () => void,
  doc = defaultDocument(),
): () => void {
  if (!doc?.body || !doc.defaultView) {
    return () => {};
  }
  let key = JSON.stringify(readMermaidPalette(doc));
  const observer = new doc.defaultView.MutationObserver(() => {
    const next = JSON.stringify(readMermaidPalette(doc));
    if (next !== key) {
      key = next;
      changed();
    }
  });
  const attributes = {
    attributes: true,
    attributeFilter: ["class", "style", "data-vscode-theme-id"],
  };
  observer.observe(doc.body, attributes);
  observer.observe(doc.documentElement, attributes);
  // Same-kind theme changes can replace the host's injected stylesheet.
  observer.observe(doc.head, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  return () => observer.disconnect();
}

export function mermaidConfiguration(
  palette: MermaidPalette,
  trusted: boolean,
): MermaidConfig {
  return {
    startOnLoad: false,
    // Mermaid 12's default "neo" look adds offset shadows and gradients of its
    // own (a filter on each node, besides the `dropShadow` variable); the
    // classic look is the flat one.
    look: "classic",
    theme: "base",
    securityLevel: "strict",
    htmlLabels: trusted,
    flowchart: { htmlLabels: trusted, useMaxWidth: false },
    sequence: { useMaxWidth: false },
    gitGraph: { useMaxWidth: false },
    er: { useMaxWidth: false },
    gantt: { useMaxWidth: true },
    journey: { useMaxWidth: true },
    class: { useMaxWidth: true },
    state: { useMaxWidth: true },
    pie: { useMaxWidth: true },
    themeVariables: mermaidThemeVariables(palette),
    suppressErrorRendering: true,
  };
}
