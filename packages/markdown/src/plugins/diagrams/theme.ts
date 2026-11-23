import type { MermaidConfig } from "mermaid";

/** Editor-derived defaults only: Mermaid still owns authored class/style rules. */
export interface MermaidPalette {
  background: string;
  foreground: string;
  surface: string;
  border: string;
  darkMode: boolean;
}

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

export function readMermaidPalette(doc = defaultDocument()): MermaidPalette {
  const body = doc?.body;
  const darkMode = Boolean(
    body?.classList.contains("vscode-dark") ||
    body?.classList.contains("vscode-high-contrast"),
  );
  const contrast = Boolean(
    body?.classList.contains("vscode-high-contrast") ||
    body?.classList.contains("vscode-high-contrast-light"),
  );
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
  const border = token(
    "--vscode-contrastBorder",
    token("--vscode-widget-border", blend(background, foreground, 0.5)),
  );
  return {
    background,
    foreground,
    border,
    darkMode,
    surface: contrast ? background : blend(background, foreground, 0.06),
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
  "actorLineColor",
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
  addNeutralScales(variables, palette);
  addNestedPalettes(variables, palette);
  return variables;
}

function addNeutralScales(
  variables: ThemeVariables,
  palette: MermaidPalette,
): void {
  // Distinguishable grayscale steps, not hue rotations, for chart families.
  for (let index = 0; index < 12; index++) {
    const shade = blend(
      palette.background,
      palette.foreground,
      0.06 + index * 0.02,
    );
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
