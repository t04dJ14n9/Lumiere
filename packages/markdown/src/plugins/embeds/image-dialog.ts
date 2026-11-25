import { imageControls } from "./image";
import { t } from "@workshop/l10n";

interface InspectorOptions {
  trigger: HTMLButtonElement;
  url: string;
  name: string;
  openFile(): void;
}
export function inspectImage(
  trigger: HTMLButtonElement,
  url: string,
  name: string,
  openFile: () => void,
): () => void {
  const inspector = new ImageInspector({ trigger, url, name, openFile });
  const show = (event: MouseEvent) => inspector.show(event);
  trigger.addEventListener("click", show);
  return () => {
    trigger.removeEventListener("click", show);
    inspector.close(false);
  };
}

class ImageInspector {
  private dialog?: HTMLDialogElement;
  private abort?: AbortController;
  private saved: unknown;
  constructor(private readonly options: InspectorOptions) {}

  close(restoreFocus = true): void {
    if (!this.dialog) {
      return;
    }
    this.abort?.abort();
    this.dialog.close();
    this.dialog.remove();
    delete this.dialog;
    if (
      restoreFocus &&
      this.options.trigger.isConnected &&
      Number(getComputedStyle(this.options.trigger).opacity) > 0
    ) {
      this.options.trigger.focus();
    }
  }

  show(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.dialog) {
      return;
    }
    this.abort = new AbortController();
    const parts = inspectorElements(this.options.name);
    this.dialog = parts.dialog;
    const { image, area, toolbar, status } = parts;
    imageControls({
      dialog: parts.dialog,
      image,
      area,
      toolbar,
      status,
      saved: this.saved,
      persist: (value) => {
        this.saved = value;
      },
      signal: this.abort.signal,
    });
    this.addActions(toolbar);
    area.append(image);
    this.dialog.append(toolbar, area, status);
    document.body.append(this.dialog);
    this.bindLifetime(parts, this.abort.signal);
    image.src = this.options.url;
    this.dialog.showModal();
    area.focus();
  }

  private addActions(toolbar: HTMLElement): void {
    const open = document.createElement("button");
    open.type = "button";
    open.textContent = t("Open image file");
    open.onclick = () => {
      this.close();
      this.options.openFile();
    };
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.textContent = t("Close");
    dismiss.setAttribute("aria-label", t("Close image"));
    dismiss.onclick = () => this.close();
    toolbar.append(open, dismiss);
  }

  private bindLifetime(
    { dialog, image, status }: ReturnType<typeof inspectorElements>,
    signal: AbortSignal,
  ): void {
    image.addEventListener(
      "error",
      () => {
        status.textContent = t("Could not load this image.");
      },
      { signal },
    );
    dialog.addEventListener(
      "cancel",
      (event) => {
        event.preventDefault();
        this.close();
      },
      { signal },
    );
    dialog.addEventListener(
      "click",
      (event) => {
        if (event.target === dialog) {
          this.close();
        }
      },
      { signal },
    );
    // Keep only the keys the inspector uses: VS Code's own shortcuts
    // (Ctrl+Alt+B and the rest) must still reach the workbench.
    dialog.addEventListener(
      "keydown",
      (event) => {
        if (event.defaultPrevented || event.key === "Escape") {
          event.stopPropagation();
        }
      },
      { signal },
    );
  }
}

function inspectorElements(name: string) {
  const dialog = document.createElement("dialog");
  dialog.className = "image-inspector";
  dialog.setAttribute("aria-label", t("Image: {0}", name));
  const toolbar = document.createElement("nav");
  toolbar.setAttribute("aria-label", t("Image controls"));
  const area = document.createElement("section");
  area.className = "media-area";
  area.setAttribute("aria-label", name);
  const image = document.createElement("img");
  image.alt = name;
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.setAttribute("aria-label", t("Image status"));
  status.textContent = t("Loading image…");
  return { dialog, toolbar, area, image, status };
}
