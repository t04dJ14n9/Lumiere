/**
 * Reads the page's translations before any other module of the page runs:
 * each page entry imports this first (imports run in order), so text the
 * page shows is in VS Code's display language (core l10n.ts).
 */
import { readL10n } from "@workshop/l10n";

readL10n(document);
