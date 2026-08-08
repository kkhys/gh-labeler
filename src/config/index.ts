import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { parseRepository, type RepositoryRef } from "#github/context.js";
import { ConfigError } from "#errors.js";
import {
  type ConfigEntry,
  isLabelDeletion,
  type LabelSpec,
  validateLabelSpec,
} from "#core/labels.js";

/** Convention-based config file names, searched in this exact order. */
export const CONVENTION_CONFIG_FILES = [
  ".gh-labeler.json",
  ".gh-labeler.yaml",
  ".gh-labeler.yml",
  ".github/labels.json",
  ".github/labels.yaml",
  ".github/labels.yml",
] as const;

export type ConfigFormat = "json" | "yaml";

/**
 * A parsed label config. Files may be either a bare array of labels
 * (legacy form) or an object: `{ "$schema"?, "prune"?, "labels": [...] }`.
 */
export interface LabelConfigFile {
  labels: ConfigEntry[];
  /** Delete repository labels that are absent from `labels`. */
  prune?: boolean;
}

export function detectFormatFromPath(path: string): ConfigFormat {
  if (path.endsWith(".json")) {
    return "json";
  }
  if (path.endsWith(".yaml") || path.endsWith(".yml")) {
    return "yaml";
  }
  throw new ConfigError(
    `Unsupported config file extension: ${path}`,
    "Use a .json, .yaml, or .yml file.",
  );
}

/** Parse config text. "auto" tries JSON first, then YAML. */
export function parseConfig(content: string, format: ConfigFormat | "auto"): LabelConfigFile {
  if (content.trim() === "") {
    throw new ConfigError("Config input is empty");
  }

  let data: unknown;
  if (format === "json") {
    data = parseJson(content);
  } else if (format === "yaml") {
    data = parseYamlContent(content);
  } else {
    try {
      data = parseJson(content);
    } catch {
      data = parseYamlContent(content);
    }
  }

  return normalizeConfigDocument(data);
}

function parseJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new ConfigError(`Invalid JSON config: ${error instanceof Error ? error.message : error}`);
  }
}

function parseYamlContent(content: string): unknown {
  try {
    return parseYaml(content);
  } catch (error) {
    throw new ConfigError(`Invalid YAML config: ${error instanceof Error ? error.message : error}`);
  }
}

function validateLabels(entries: unknown[]): ConfigEntry[] {
  const labels = entries.map((entry, i) => validateLabelSpec(entry, `labels[${i}]`));

  // GitHub label names are case-insensitively unique; duplicates would fail
  // at sync time (422) or trigger spurious similarity renames, so fail here.
  const seen = new Map<string, number>();
  for (const [i, label] of labels.entries()) {
    const key = label.name.toLowerCase();
    const first = seen.get(key);
    if (first !== undefined) {
      throw new ConfigError(
        `labels[${i}] ("${label.name}"): duplicate label name (already declared at labels[${first}])`,
        "GitHub label names are unique ignoring case; merge the entries or remove one.",
      );
    }
    seen.set(key, i);
  }

  // Alias contradictions would be resolved silently by the planner (declared
  // names always win, first alias claim wins), so reject them here instead.
  const aliasAt = new Map<string, number>();
  for (const [i, label] of labels.entries()) {
    if (isLabelDeletion(label)) {
      continue;
    }
    for (const alias of label.aliases ?? []) {
      const key = alias.toLowerCase();
      const nameAt = seen.get(key);
      if (nameAt !== undefined) {
        throw new ConfigError(
          `labels[${i}] ("${label.name}"): alias "${alias}" is also a declared label name (labels[${nameAt}])`,
          "An alias is an old name to rename from; a name still declared in the config cannot be one.",
        );
      }
      const first = aliasAt.get(key);
      if (first !== undefined) {
        throw new ConfigError(
          `labels[${i}] ("${label.name}"): duplicate alias "${alias}" (already claimed at labels[${first}])`,
          "Two entries cannot share an alias; keep it on the one label it should rename to.",
        );
      }
      aliasAt.set(key, i);
    }
  }

  return labels;
}

function normalizeConfigDocument(data: unknown): LabelConfigFile {
  if (Array.isArray(data)) {
    return { labels: validateLabels(data) };
  }

  if (typeof data === "object" && data !== null) {
    const { labels, prune } = data as Record<string, unknown>;
    if (!Array.isArray(labels)) {
      throw new ConfigError(
        'Config object must contain a "labels" array',
        'Use either a bare array of labels or { "labels": [...], "prune": true|false }.',
      );
    }
    const config: LabelConfigFile = {
      labels: validateLabels(labels),
    };
    if (prune !== undefined) {
      if (typeof prune !== "boolean") {
        throw new ConfigError('"prune" must be a boolean');
      }
      config.prune = prune;
    }
    return config;
  }

  throw new ConfigError(
    'Config must be a label array or an object with a "labels" array',
    "Run `gh-labeler init` to generate a valid starting point.",
  );
}

export function loadConfigFile(path: string): LabelConfigFile {
  if (!existsSync(path)) {
    throw new ConfigError(
      `Config file not found: ${path}`,
      "Run `gh-labeler init` to create one, or pass --config with a valid path.",
    );
  }
  return parseConfig(readFileSync(path, "utf8"), detectFormatFromPath(path));
}

export function loadConfigFromStdin(): LabelConfigFile {
  let content: string;
  try {
    content = readFileSync(0, "utf8");
  } catch {
    content = "";
  }
  if (content.trim() === "") {
    throw new ConfigError(
      "No config received on stdin",
      'Pipe a JSON/YAML label config into "--config -".',
    );
  }
  return parseConfig(content, "auto");
}

/** First convention file that exists in `dir`, or null. */
export function findConventionConfig(dir: string): string | null {
  for (const filename of CONVENTION_CONFIG_FILES) {
    const path = join(dir, filename);
    if (existsSync(path)) {
      return path;
    }
  }
  return null;
}

export const CONFIG_SCHEMA_URL =
  "https://raw.githubusercontent.com/kkhys/gh-labeler/main/schema/labels.schema.json";

function labelToConfigShape(label: LabelSpec): Record<string, unknown> {
  return {
    name: label.name,
    color: label.color,
    ...(label.description !== undefined && { description: label.description }),
    ...(label.aliases !== undefined && label.aliases.length > 0 && { aliases: label.aliases }),
  };
}

/**
 * Serialize labels into a config document (object form) with editor schema
 * support: `$schema` for JSON, a yaml-language-server directive for YAML.
 */
export function serializeConfigDocument(labels: LabelSpec[], format: ConfigFormat): string {
  const shaped = labels.map((label) => labelToConfigShape(label));
  if (format === "json") {
    return `${JSON.stringify({ $schema: CONFIG_SCHEMA_URL, labels: shaped }, null, 2)}\n`;
  }
  return `# yaml-language-server: $schema=${CONFIG_SCHEMA_URL}\n${stringifyYaml({ labels: shaped })}`;
}

/** Fetches a file from a repository; resolves null when the file is absent. */
export interface RemoteFileFetcher {
  fetchFile: (owner: string, repo: string, path: string) => Promise<string | null>;
}

export interface RemoteConfigRef extends RepositoryRef {
  path?: string;
}

/** Parse "owner/repo" or "owner/repo:path/to/labels.yml". */
export function parseRemoteConfigRef(spec: string): RemoteConfigRef {
  const colon = spec.indexOf(":");
  if (colon === -1) {
    return { ...parseRepository(spec) };
  }
  const repoPart = spec.slice(0, colon);
  const path = spec.slice(colon + 1);
  if (!path) {
    throw new ConfigError(
      `Empty file path in remote config spec: "${spec}"`,
      'Use "owner/repo" or "owner/repo:path/to/labels.yml".',
    );
  }
  return { ...parseRepository(repoPart), path };
}

/**
 * Fetch a label config from another repository. With an explicit path the
 * file must exist; without one the convention file names are tried in order.
 */
export async function fetchRemoteConfig(
  fetcher: RemoteFileFetcher,
  ref: RemoteConfigRef,
): Promise<LabelConfigFile> {
  const repository = `${ref.owner}/${ref.repo}`;

  if (ref.path) {
    const content = await fetcher.fetchFile(ref.owner, ref.repo, ref.path);
    if (content === null) {
      throw new ConfigError(`Remote config not found: ${repository}:${ref.path}`);
    }
    return parseConfig(content, detectFormatFromPath(ref.path));
  }

  for (const filename of CONVENTION_CONFIG_FILES) {
    // Sequential by design: convention files are tried in priority order and
    // the first hit wins, so parallel fetching would waste requests.
    // eslint-disable-next-line no-await-in-loop
    const content = await fetcher.fetchFile(ref.owner, ref.repo, filename);
    if (content !== null) {
      return parseConfig(content, detectFormatFromPath(filename));
    }
  }

  throw new ConfigError(
    `No label config found in ${repository}`,
    `Searched for: ${CONVENTION_CONFIG_FILES.join(", ")}`,
  );
}
