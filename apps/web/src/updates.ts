/**
 * A new build, offered to the reader instead of swapped in under a running
 * window. Its service worker installs and waits (src/worker/sw.ts): the
 * window and the editor pages it opens must come from one build, and file
 * names are not hashed. Once one waits, the window offers a reload; on the
 * reader's yes it tells the worker to take over, and every window of the
 * app, this one and any other, saves its notes and reloads into the new
 * build when the worker does.
 */
import { TAKE_OVER } from "./shared/messages";

type Listen = (type: string, listener: () => void) => void;

export interface UpdateParts {
  /** This app's worker registration. */
  readonly registration: {
    readonly waiting: { postMessage(message: unknown): void } | null;
    readonly installing: {
      readonly state: string;
      addEventListener: Listen;
    } | null;
    addEventListener: Listen;
  };
  /** `navigator.serviceWorker`. */
  readonly workers: { readonly controller: unknown; addEventListener: Listen };
  /** Show the reader that a new build waits; `accept` reloads into it. */
  readonly offer: (accept: () => void) => void;
  /** Write unsaved notes, before the reload. */
  readonly saveAll: () => Promise<void>;
  readonly reload: () => void;
}

export function offerUpdates(parts: UpdateParts): void {
  const { registration, workers } = parts;
  // The first worker takes over a window that had none: no reload for that.
  let isControlled = Boolean(workers.controller);
  workers.addEventListener("controllerchange", () => {
    if (!isControlled) {
      isControlled = true;
      return;
    }
    void parts
      .saveAll()
      .catch((error: unknown) =>
        console.error("Lumière could not save before updating", error),
      )
      .finally(() => parts.reload());
  });
  const offerIfWaiting = () => {
    if (registration.waiting && workers.controller) {
      parts.offer(() => registration.waiting?.postMessage(TAKE_OVER));
    }
  };
  registration.addEventListener("updatefound", () => {
    const installing = registration.installing;
    installing?.addEventListener("statechange", () => {
      if (installing.state === "installed") {
        offerIfWaiting();
      }
    });
  });
  offerIfWaiting();
}

/** The offer, as a banner over the window until the reader answers. */
export function updateBanner(accept: () => void): void {
  if (document.querySelector(".lumiere-update")) {
    return;
  }
  const banner = document.createElement("div");
  // The window's own banner style (packages/app/src/shell/styles.css).
  banner.className = "error-banner lumiere-update";
  banner.setAttribute("role", "status");
  const text = document.createElement("span");
  text.textContent = "A new version of Lumière is ready.";
  const reload = document.createElement("button");
  reload.type = "button";
  reload.textContent = "Reload";
  reload.addEventListener("click", () => {
    reload.disabled = true;
    accept();
  });
  const later = document.createElement("button");
  later.type = "button";
  later.textContent = "Later";
  later.addEventListener("click", () => banner.remove());
  banner.append(text, reload, later);
  document.body.append(banner);
}
