/** Quote a YAML scalar so colons and spaces stay Properties-friendly. */
function yamlScalar(value: string): string {
  return JSON.stringify(value);
}

export function scratchNote(title: string, capturedAt: string): string {
  return [
    "---",
    `title: ${yamlScalar(title)}`,
    `captured: ${yamlScalar(capturedAt)}`,
    "---",
    "",
    "",
  ].join("\n");
}

export function noteSlug(title: string): string {
  const ascii = asciiText(title.normalize("NFKD"));
  const slug = ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "note";
}

function asciiText(value: string): string {
  let ascii = "";
  for (const character of value) {
    if (character.charCodeAt(0) < 128) {
      ascii += character;
    }
  }
  return ascii;
}
