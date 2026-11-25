/**
 * The manifest's text in VS Code's localization files: each user-facing
 * string of `contributes` becomes a `%key%` placeholder, and its English
 * text goes in package.nls.json under that key; package.nls.<language>.json
 * translates it. Keys name what the text belongs to (`command.<id>.title`,
 * `config.<setting>.description`), so a reworded string keeps its key.
 *
 * Brand names stay as they are: command categories ("Lumiere", "Lumiere
 * PDF", "PDF") and the settings sections' titles.
 */

type Json = Record<string, unknown>;

export interface Externalized {
  contributes: Json;
  nls: Record<string, string>;
}

class Collector {
  readonly nls: Record<string, string> = {};

  /** `%key%` for `text`, recording the English; undefined text stays so. */
  take(key: string, text: unknown): unknown {
    if (typeof text !== "string" || text === "") {
      return text;
    }
    if (key in this.nls && this.nls[key] !== text) {
      throw new Error(`Two manifest texts share the key ${key}`);
    }
    this.nls[key] = text;
    return `%${key}%`;
  }

  /** Each named field of `entry` under `prefix.<field>`. */
  fields(entry: Json, prefix: string, names: readonly string[]): Json {
    const out = { ...entry };
    for (const name of names) {
      if (name in out) {
        out[name] = this.take(`${prefix}.${name}`, out[name]);
      }
    }
    return out;
  }
}

const SETTING_TEXT = [
  "description",
  "markdownDescription",
  "deprecationMessage",
  "markdownDeprecationMessage",
] as const;

function setting(collector: Collector, id: string, schema: Json): Json {
  const out = collector.fields(schema, `config.${id}`, SETTING_TEXT);
  for (const list of ["enumDescriptions", "markdownEnumDescriptions"]) {
    const texts = out[list];
    if (Array.isArray(texts)) {
      out[list] = texts.map((text, index) =>
        collector.take(`config.${id}.${list}.${index}`, text),
      );
    }
  }
  return out;
}

function configuration(collector: Collector, sections: unknown): unknown {
  return (sections as Json[]).map((section) => {
    const properties = section.properties as Record<string, Json> | undefined;
    if (!properties) {
      return section;
    }
    return {
      ...section,
      properties: Object.fromEntries(
        Object.entries(properties).map(([id, schema]) => [
          id,
          setting(collector, id, schema),
        ]),
      ),
    };
  });
}

function views(collector: Collector, containers: unknown): unknown {
  return Object.fromEntries(
    Object.entries(containers as Record<string, Json[]>).map(
      ([container, list]) => [
        container,
        list.map((view) =>
          collector.fields(view, `view.${String(view.id)}`, ["name"]),
        ),
      ],
    ),
  );
}

function welcome(collector: Collector, entries: unknown): unknown {
  const seen = new Map<string, number>();
  return (entries as Json[]).map((entry) => {
    const view = String(entry.view);
    const index = seen.get(view) ?? 0;
    seen.set(view, index + 1);
    return collector.fields(entry, `viewsWelcome.${view}.${index}`, [
      "contents",
    ]);
  });
}

export function externalize(contributes: Json): Externalized {
  const collector = new Collector();
  const out: Json = { ...contributes };
  const each = (key: string, map: (entry: Json) => Json): void => {
    if (Array.isArray(out[key])) {
      out[key] = (out[key] as Json[]).map(map);
    }
  };
  each("commands", (command) =>
    collector.fields(command, `command.${String(command.command)}`, [
      "title",
      "shortTitle",
    ]),
  );
  each("customEditors", (editor) =>
    collector.fields(editor, `customEditor.${String(editor.viewType)}`, [
      "displayName",
    ]),
  );
  each("submenus", (submenu) =>
    collector.fields(submenu, `submenu.${String(submenu.id)}`, ["label"]),
  );
  if (out.configuration) {
    out.configuration = configuration(collector, out.configuration);
  }
  if (out.views) {
    out.views = views(collector, out.views);
  }
  if (out.viewsWelcome) {
    out.viewsWelcome = welcome(collector, out.viewsWelcome);
  }
  return { contributes: out, nls: sortKeys(collector.nls) };
}

function sortKeys(nls: Record<string, string>): Record<string, string> {
  const keys = Object.keys(nls).sort();
  return Object.fromEntries(keys.map((key) => [key, nls[key]!]));
}
