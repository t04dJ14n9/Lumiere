export interface Folding {
  foldAll(): boolean;
  unfoldAll(): boolean;
  toggle(): boolean;
}
declare module "@workshop/core" {
  interface Services {
    fold: Folding;
  }
  interface Events {
    /**
     * The Fold All or Unfold All command ran (Vim's zM and zR run them too).
     * The service's `foldAll` and `unfoldAll` do not emit it. @mode emit
     */
    "folding/allCommand": (command: "foldAll" | "unfoldAll") => void;
  }
}
