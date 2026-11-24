export interface RenderOptions {
  /** Fragments retain leading thematic breaks; only whole documents have properties. */
  fragment?: boolean;
  /** Definitions parsed separately into a fresh parser environment. */
  referenceDefinitions?: string;
  /**
   * The same definitions as a shared set, for one side's blocks. The set is
   * parsed once per renderer and each render gets its own layer over it, so a
   * block's own definitions never reach another block. Takes precedence over
   * referenceDefinitions when both are given.
   */
  definitionSet?: DefinitionSet;
  strictLineBreaks?: boolean;
  sanitize?: (html: string) => string;
  source?: string;
  docId?: string;
}
export interface RendererOptions {
  strictLineBreaks?: boolean;
  calloutIcon?: (kind: string) => string;
}
/** Reference definitions shared by one side's blocks; the object's identity keys its parse. */
export interface DefinitionSet {
  readonly text: string;
}
