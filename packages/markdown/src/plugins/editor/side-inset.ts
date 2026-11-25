import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";

/**
 * Publishes the left gutters' width and the scrollbar's width as CSS
 * variables on the editor, so the stylesheet can give the text as much room
 * on the right as the gutters take on the left (base.css, line numbers off).
 */
class SideInset {
  private readonly measurement = {
    read: (view: EditorView) => ({
      gutters:
        view.scrollDOM.querySelector<HTMLElement>(":scope > .cm-gutters")
          ?.offsetWidth ?? 0,
      scrollbar: view.scrollDOM.offsetWidth - view.scrollDOM.clientWidth,
    }),
    write: (
      inset: { gutters: number; scrollbar: number },
      view: EditorView,
    ) => {
      view.dom.style.setProperty("--mw-gutters-width", `${inset.gutters}px`);
      view.dom.style.setProperty(
        "--mw-scrollbar-width",
        `${inset.scrollbar}px`,
      );
    },
  };

  constructor(private readonly view: EditorView) {
    view.requestMeasure(this.measurement);
  }

  update(update: ViewUpdate): void {
    if (update.geometryChanged || update.viewportChanged) {
      this.view.requestMeasure(this.measurement);
    }
  }
}

export const sideInset = ViewPlugin.fromClass(SideInset);
