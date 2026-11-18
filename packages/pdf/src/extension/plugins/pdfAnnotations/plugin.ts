import * as path from "node:path";
import * as vscode from "vscode";
import type { Plugin } from "@workshop/core";
import { VIEW_COMMAND_IDS } from "../../../shared/command-ids";
import { isProtectedPdf, PROTECTED_FOLDERS } from "../../protected-folders";
import type { PdfPanel } from "../pdf/panel";
import manifest from "./manifest";
import { editAnnotationNote } from "./mark-notes";
import type {} from "../services";

/**
 * Marks are made and changed from the viewer's context menu. The one
 * command that asks for a note first (Edit Note…) is here; the rest are
 * plain viewer actions (`view-commands.ts`).
 *
 * Annotations are kept outside the PDF, never in it (see `annotation-store`).
 * Writing them into a PDF is a command the reader runs: Save Annotations
 * into This PDF (refused in protected folders, such as a vault's sources),
 * or Export Annotated Copy. The panel writes the PDF only when this command
 * asked, and `vscodePdfFiles` refuses protected folders again, so a viewer
 * that sends a PDF on its own changes nothing.
 */
export const pdfAnnotationsPlugin: Plugin = {
  name: manifest.id,
  inject: { required: ["pdfPanels", "extensionContext"] },
  apply(ctx) {
    const panels = ctx.pdfPanels;
    for (const panel of panels.all) {
      ctx.own(attach(panel), `panel:${panel.viewId}`);
    }
    ctx.own(
      panels.onDidOpen((panel) =>
        ctx.own(attach(panel), `panel:${panel.viewId}`),
      ),
      "open listener",
    );
    ctx.own(
      vscode.commands.registerCommand(
        VIEW_COMMAND_IDS.annotationRetrySave,
        () => panels.active?.postAnnotationRetry(),
      ),
      "retry command",
    );
    ctx.own(
      vscode.commands.registerCommand(
        VIEW_COMMAND_IDS.saveAnnotationsIntoPdf,
        () => panels.active && saveIntoPdf(panels.active),
      ),
      "save into PDF command",
    );
    ctx.own(
      vscode.commands.registerCommand(VIEW_COMMAND_IDS.editAnnotationNote, () =>
        editAnnotationNote(panels),
      ),
      "edit note command",
    );
    ctx.own(
      vscode.commands.registerCommand(
        VIEW_COMMAND_IDS.exportAnnotatedCopy,
        () => panels.active?.writeAnnotations("copy"),
      ),
      "export copy command",
    );
  },
};

/** One editor's annotation prompts: conflicts, failures, exports, edits to the PDF's own. */
function attach(panel: PdfPanel): vscode.Disposable {
  let toldAboutPdfAnnotations = false;
  const subscriptions = [
    panel.onAnnotationConflict(async (payload) => {
      const choice = await vscode.window.showWarningMessage(
        "This PDF changed on disk while you were saving annotations into it.",
        { modal: true },
        "Reload",
        "Keep mine",
      );
      if (choice === "Reload") {
        await panel.reloadFromDisk();
      } else if (choice === "Keep mine") {
        await panel.keepMine(payload);
      }
    }),
    panel.onAnnotationSaveFailed(async () => {
      const choice = await vscode.window.showErrorMessage(
        "Could not save PDF annotations.",
        "Retry",
      );
      if (choice === "Retry") {
        panel.postAnnotationRetry();
      }
    }),
    panel.onAnnotationExport((data) => void exportCopy(panel.uri, data)),
    panel.onAnnotationEmbeddedEdit(async () => {
      if (toldAboutPdfAnnotations) {
        return;
      }
      toldAboutPdfAnnotations = true;
      const save = "Save into This PDF";
      const choice = await vscode.window.showInformationMessage(
        "That annotation is part of the PDF file. Lumiere keeps changes to it only if you save them into the PDF.",
        save,
      );
      if (choice === save) {
        await saveIntoPdf(panel);
      }
    }),
  ];
  return vscode.Disposable.from(...subscriptions);
}

async function saveIntoPdf(panel: PdfPanel): Promise<void> {
  const relative = vscode.workspace.asRelativePath(panel.uri, false);
  if (isProtectedPdf(panel.uri)) {
    const exportCopy = "Export Annotated Copy…";
    const choice = await vscode.window.showWarningMessage(
      `${relative} is in a protected folder (${PROTECTED_FOLDERS}), so Lumiere does not write it. Its annotations stay in .lumiere/pdf-annotations.`,
      exportCopy,
    );
    if (choice === exportCopy) {
      panel.writeAnnotations("copy");
    }
    return;
  }
  const save = "Save into PDF";
  const choice = await vscode.window.showWarningMessage(
    `Save the annotations into ${relative}?`,
    {
      modal: true,
      detail:
        "This rewrites the PDF file, so its SHA-256 changes. Annotations kept for the file as it is now stay kept for that version.",
    },
    save,
  );
  if (choice === save) {
    panel.writeAnnotations("pdf");
  }
}

async function exportCopy(
  source: vscode.Uri,
  data: ArrayBuffer,
): Promise<void> {
  const name = path.posix.basename(source.path).replace(/\.pdf$/iu, "");
  const folder = isProtectedPdf(source)
    ? (vscode.workspace.getWorkspaceFolder(source)?.uri ??
      vscode.Uri.joinPath(source, ".."))
    : vscode.Uri.joinPath(source, "..");
  const target = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.joinPath(folder, `${name} (annotated).pdf`),
    filters: { PDF: ["pdf"] },
    saveLabel: "Export",
  });
  if (!target) {
    return;
  }
  if (target.toString() === source.toString()) {
    void vscode.window.showErrorMessage(
      "Export Annotated Copy writes a new file; use Save Annotations into This PDF to change this one.",
    );
    return;
  }
  try {
    await vscode.workspace.fs.writeFile(target, new Uint8Array(data));
    void vscode.window.showInformationMessage(
      `Exported ${vscode.workspace.asRelativePath(target, false)}.`,
    );
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Could not export the annotated copy: ${String(error)}`,
    );
  }
}
