import type {
  PropertyKind,
  PropertyTypes,
} from "../../markdown/properties/types";
import {
  canSetPropertyType,
  propertyKind,
} from "../../markdown/properties/types";
import type { ObsidianCompat, WirePropertyType } from "../obsidianCompat/api";
import type { PropertyTypeStore } from "./type-store";

/** Obsidian's `multitext` is the List kind; the other names are shared. */
function kindOf(type: string): PropertyKind | undefined {
  if (type === "multitext") {
    return "list";
  }
  return type !== "list" && propertyKind(type) ? type : undefined;
}

function wireTypeOf(kind: PropertyKind): WirePropertyType {
  return kind === "list" ? "multitext" : kind;
}

/**
 * A vault's property types, as the properties UI uses them: the vault's
 * `.obsidian/types.json` (Obsidian's registry, shared with Obsidian), with
 * the types chosen in Lumiere where the registry cannot hold them on top.
 * A type chosen in Lumiere is offered to `types.json` when the vault has
 * one; no host writes it today (none can replace the file atomically), so
 * it stays in Lumiere's workspace storage, which Obsidian does not see.
 */
export class VaultPropertyTypes {
  constructor(
    private readonly root: string,
    private readonly local: PropertyTypeStore,
    private readonly obsidian: ObsidianCompat | undefined,
  ) {}

  async read(): Promise<PropertyTypes> {
    return { ...(await this.registry()), ...this.local.read(this.root) };
  }

  async set(key: string, kind: PropertyKind | null): Promise<PropertyTypes> {
    if (!canSetPropertyType(key, kind)) {
      throw new Error("Invalid or reserved property type preference");
    }
    if (await this.writeRegistry(key, kind)) {
      // The registry holds it now; a Lumiere-only type would mask it.
      if (Object.hasOwn(this.local.read(this.root), key.toLowerCase())) {
        await this.local.set(this.root, key, null);
      }
    } else {
      await this.local.set(this.root, key, kind);
    }
    return this.read();
  }

  /** `types.json`'s editable types, by lower-case name. */
  private async registry(): Promise<PropertyTypes> {
    const types = await this.registryTypes();
    const kinds: Record<string, PropertyKind> = {};
    for (const [name, type] of Object.entries(types)) {
      const kind = kindOf(type);
      if (kind && canSetPropertyType(name, kind)) {
        kinds[name.toLowerCase()] = kind;
      }
    }
    return kinds;
  }

  private async registryTypes(): Promise<Readonly<Record<string, string>>> {
    if (!this.obsidian) {
      return {};
    }
    try {
      return await this.obsidian.getPropertyTypes({ vaultRoot: this.root });
    } catch {
      return {};
    }
  }

  /**
   * Writes to `types.json` when the vault has a registry with types in it;
   * never creates one in a folder Obsidian does not use. False when it did
   * not write.
   */
  private async writeRegistry(
    key: string,
    kind: PropertyKind | null,
  ): Promise<boolean> {
    const types = await this.registryTypes();
    if (!this.obsidian || Object.keys(types).length === 0) {
      return false;
    }
    // Keep the name as the registry writes it, whatever its case here.
    const name =
      Object.keys(types).find(
        (existing) => existing.toLowerCase() === key.toLowerCase(),
      ) ?? key.toLowerCase();
    try {
      await this.obsidian.setPropertyType(
        { vaultRoot: this.root },
        name,
        kind === null ? null : wireTypeOf(kind),
      );
      return true;
    } catch {
      return false;
    }
  }
}
