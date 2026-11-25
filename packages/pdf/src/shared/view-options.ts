import type { PageLayout, ScrollDirection, ScrollMode } from "./view-settings";
import { t } from "@workshop/l10n";

export const PAGE_LAYOUTS: {
  value: PageLayout;
  label: string;
  command: string;
}[] = [
  {
    value: "single",
    get label() {
      return t("Single page");
    },
    command: "singlePage",
  },
  {
    value: "spread",
    get label() {
      return t("Two pages (1–2, 3–4)");
    },
    command: "twoPageSpread",
  },
  {
    value: "spreadCover",
    get label() {
      return t("Two pages with cover (1, 2–3)");
    },
    command: "twoPageCover",
  },
];
export const SCROLL_MODES: {
  value: ScrollMode;
  label: string;
  command: string;
}[] = [
  {
    value: "continuous",
    get label() {
      return t("Continuous");
    },
    command: "continuousScroll",
  },
  {
    value: "paged",
    get label() {
      return t("Page-by-page");
    },
    command: "pageByPage",
  },
];
export const SCROLL_DIRECTIONS: {
  value: ScrollDirection;
  label: string;
  command: string;
}[] = [
  {
    value: "vertical",
    get label() {
      return t("Vertical");
    },
    command: "verticalScroll",
  },
  {
    value: "horizontal",
    get label() {
      return t("Horizontal");
    },
    command: "horizontalScroll",
  },
];
