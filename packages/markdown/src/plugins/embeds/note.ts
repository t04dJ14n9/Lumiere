import { noteFragment } from "../../markdown/metadata/fragments";

/** The embedded note exists but has no such heading or block. */
export class MissingSection extends Error {
  constructor() {
    super("Embedded section not found");
  }
}
/** Embeds deeper than this are not shown. */
const MAX_EMBED_DEPTH = 12;

/** The note embeds itself, or embeds nest deeper than MAX_EMBED_DEPTH. */
export class RefusedEmbed extends Error {
  constructor(readonly reason: "circular" | "too deep") {
    super(
      reason === "circular" ? "Circular embed" : "Embeds nested too deeply",
    );
  }
}

export function embeddedNote(
  text: string,
  source: string,
  target: string,
  ancestry: readonly string[],
) {
  const fragment = target.includes("#")
    ? target.slice(target.indexOf("#") + 1)
    : "";
  const key = `${source}#${fragment}`;
  if (ancestry.includes(key)) {
    throw new RefusedEmbed("circular");
  }
  if (ancestry.length >= MAX_EMBED_DEPTH) {
    throw new RefusedEmbed("too deep");
  }
  const selection = noteFragment(text, fragment);
  if (!selection) {
    throw new MissingSection();
  }
  return {
    ...selection,
    ancestry: [...ancestry, key],
    sourceLine: text.slice(0, selection.from).split("\n").length - 1,
  };
}
