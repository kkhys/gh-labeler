import { ConfigError } from "#errors.js";

/**
 * A desired label as declared in configuration.
 * Color invariant: the config layer always carries `#rrggbb` (with `#`);
 * the GitHub API layer always carries `rrggbb` (without `#`). Conversion
 * happens exactly at that boundary via {@link normalizeColor}.
 */
export interface LabelSpec {
  name: string;
  color: string;
  description?: string;
  /** Old names for this label; an existing label matching one is renamed. */
  aliases?: string[];
}

/** A config entry that only removes a label; `name` is all it needs. */
export interface LabelDeletion {
  name: string;
  delete: true;
}

export type ConfigEntry = LabelSpec | LabelDeletion;

export function isLabelDeletion(entry: ConfigEntry): entry is LabelDeletion {
  return "delete" in entry;
}

/** GitHub rejects label descriptions longer than this (API-documented cap). */
export const MAX_DESCRIPTION_LENGTH = 100;

/** Strip the leading `#` and lowercase, producing the API-layer form. */
export function normalizeColor(color: string): string {
  return color.replace(/^#/u, "").toLowerCase();
}

/** Valid 6-digit hex without `#`. 3-digit shorthand is rejected by design. */
export function isValidHexColor(color: string): boolean {
  return /^[0-9a-fA-F]{6}$/u.test(color);
}

/**
 * Structurally validate one label entry from untyped config data.
 * `where` names the location (e.g. `labels[2]`) for precise error messages.
 */
export function validateLabelSpec(raw: unknown, where: string): ConfigEntry {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ConfigError(`${where}: each label must be an object with "name" and "color"`);
  }
  const entry = raw as Record<string, unknown>;

  const { name } = entry;
  if (typeof name !== "string" || name.trim() === "") {
    throw new ConfigError(`${where}: "name" must be a non-empty string`);
  }

  const del = entry["delete"];
  if (del !== undefined && del !== null && typeof del !== "boolean") {
    throw new ConfigError(`${where} ("${name}"): "delete" must be a boolean`);
  }

  // Label fields are validated even on deletion entries (they are usually a
  // former label entry with `delete: true` added, so typos should still be
  // caught), but only `name` carries meaning there.
  const { color } = entry;
  if (
    color !== undefined &&
    color !== null &&
    (typeof color !== "string" || !color.startsWith("#") || !isValidHexColor(color.slice(1)))
  ) {
    throw new ConfigError(
      `${where} ("${name}"): invalid color ${JSON.stringify(color)}`,
      'Colors must be 6-digit hex with a "#" prefix, e.g. "#d73a4a". 3-digit shorthand is not supported.',
    );
  }

  const { description } = entry;
  if (description !== undefined && description !== null) {
    if (typeof description !== "string") {
      throw new ConfigError(`${where} ("${name}"): "description" must be a string`);
    }
    // Count code points, not UTF-16 units, matching GitHub's character limit.
    if ([...description].length > MAX_DESCRIPTION_LENGTH) {
      throw new ConfigError(
        `${where} ("${name}"): "description" exceeds ${MAX_DESCRIPTION_LENGTH} characters`,
        `GitHub caps label descriptions at ${MAX_DESCRIPTION_LENGTH} characters.`,
      );
    }
  }

  const { aliases } = entry;
  if (
    aliases !== undefined &&
    aliases !== null &&
    (!Array.isArray(aliases) || aliases.some((a) => typeof a !== "string"))
  ) {
    throw new ConfigError(`${where} ("${name}"): "aliases" must be an array of strings`);
  }

  if (del === true) {
    return { name, delete: true };
  }

  if (typeof color !== "string") {
    throw new ConfigError(
      `${where} ("${name}"): "color" is required`,
      'Only entries with "delete": true may omit "color".',
    );
  }

  const spec: LabelSpec = { name, color };
  if (typeof description === "string") {
    spec.description = description;
  }
  if (Array.isArray(aliases)) {
    spec.aliases = aliases as string[];
  }
  return spec;
}

/** Starter label set used by `gh-labeler init`. */
export function defaultLabels(): LabelSpec[] {
  return [
    {
      name: "bug",
      color: "#d73a4a",
      description: "Something isn't working",
      aliases: ["defect"],
    },
    {
      name: "enhancement",
      color: "#a2eeef",
      description: "New feature or request",
      aliases: ["feature"],
    },
    {
      name: "documentation",
      color: "#0075ca",
      description: "Improvements or additions to documentation",
      aliases: ["docs"],
    },
    {
      name: "duplicate",
      color: "#cfd3d7",
      description: "This issue or pull request already exists",
    },
    {
      name: "good first issue",
      color: "#7057ff",
      description: "Good for newcomers",
      aliases: ["beginner-friendly"],
    },
    {
      name: "help wanted",
      color: "#008672",
      description: "Extra attention is needed",
    },
  ];
}
