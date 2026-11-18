const DEFAULT_COPY_FEEDBACK_MS = 1_200;

interface CopyState {
  writing: boolean;
  reset: number | undefined;
}

interface CopyFeedbackOptions {
  button: HTMLButtonElement;
  write: () => Promise<unknown>;
  onError(error: unknown): void;
  durationMs?: number;
}

const states = new WeakMap<HTMLButtonElement, CopyState>();

/**
 * Runs a clipboard write and confirms it on the triggering button only after
 * the write succeeds. Repeated clicks while a write is pending are ignored.
 */
export async function copyWithFeedback({
  button,
  write,
  onError,
  durationMs = DEFAULT_COPY_FEEDBACK_MS,
}: CopyFeedbackOptions): Promise<void> {
  const state = states.get(button) ?? { writing: false, reset: undefined };
  states.set(button, state);
  if (state.writing) {
    return;
  }

  state.writing = true;
  try {
    await write();
    if (!button.isConnected) {
      return;
    }
    if (state.reset !== undefined) {
      window.clearTimeout(state.reset);
    }
    button.textContent = "Copied";
    button.setAttribute("aria-label", "Copied");
    button.classList.remove("is-copied");
    void button.offsetWidth;
    button.classList.add("is-copied");
    state.reset = window.setTimeout(() => {
      state.reset = undefined;
      if (!button.isConnected) {
        return;
      }
      button.textContent = "Copy";
      button.setAttribute("aria-label", "Copy code");
      button.classList.remove("is-copied");
    }, durationMs);
  } catch (error) {
    onError(error);
  } finally {
    state.writing = false;
  }
}
