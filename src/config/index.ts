import { existsSync, readFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
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
  /** Unresolved base config refs; absent once extends resolution has run. */
  extends?: string[];
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
    const { labels, prune, extends: extendsRaw } = data as Record<string, unknown>;
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
    if (extendsRaw !== undefined) {
      config.extends = normalizeExtendsField(extendsRaw);
    }
    return config;
  }

  throw new ConfigError(
    'Config must be a label array or an object with a "labels" array',
    "Run `gh-labeler init` to generate a valid starting point.",
  );
}

function normalizeExtendsField(raw: unknown): string[] {
  const list = typeof raw === "string" ? [raw] : raw;
  if (!Array.isArray(list) || list.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new ConfigError(
      '"extends" must be a string or an array of non-empty strings',
      'Each entry is a path starting with "./", "../", or "/" (relative to this config), or "owner/repo[:path]".',
    );
  }
  return list as string[];
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

async function fetchRemoteConfigFile(
  fetcher: RemoteFileFetcher,
  ref: RemoteConfigRef,
): Promise<{ config: LabelConfigFile; path: string }> {
  const repository = `${ref.owner}/${ref.repo}`;

  if (ref.path) {
    const content = await fetcher.fetchFile(ref.owner, ref.repo, ref.path);
    if (content === null) {
      throw new ConfigError(`Remote config not found: ${repository}:${ref.path}`);
    }
    return { config: parseConfig(content, detectFormatFromPath(ref.path)), path: ref.path };
  }

  for (const filename of CONVENTION_CONFIG_FILES) {
    // Sequential by design: convention files are tried in priority order and
    // the first hit wins, so parallel fetching would waste requests.
    // eslint-disable-next-line no-await-in-loop
    const content = await fetcher.fetchFile(ref.owner, ref.repo, filename);
    if (content !== null) {
      return { config: parseConfig(content, detectFormatFromPath(filename)), path: filename };
    }
  }

  throw new ConfigError(
    `No label config found in ${repository}`,
    `Searched for: ${CONVENTION_CONFIG_FILES.join(", ")}`,
  );
}

/**
 * Fetch a label config from another repository, extends resolved. With an
 * explicit path the file must exist; without one the convention file names
 * are tried in order.
 */
export async function fetchRemoteConfig(
  fetcher: RemoteFileFetcher,
  ref: RemoteConfigRef,
): Promise<LabelConfigFile> {
  const { config, path } = await fetchRemoteConfigFile(fetcher, ref);
  return resolveExtendedConfig(
    config,
    { kind: "remote", owner: ref.owner, repo: ref.repo, dir: posix.dirname(path) },
    fetcher,
    [remoteId(ref.owner, ref.repo, path)],
  );
}

/** Where a config file came from; extends paths resolve against it. */
type ConfigOrigin =
  | { kind: "local"; dir: string }
  | { kind: "remote"; owner: string; repo: string; dir: string };

type ExtendsRef = { kind: "path"; path: string } | ({ kind: "repo" } & RemoteConfigRef);

function parseExtendsRef(spec: string): ExtendsRef {
  if (spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("/")) {
    return { kind: "path", path: spec };
  }
  try {
    return { kind: "repo", ...parseRemoteConfigRef(spec) };
  } catch {
    throw new ConfigError(
      `Invalid extends reference: "${spec}"`,
      'Use a path starting with "./", "../", or "/" (relative to the extending config), or "owner/repo[:path]".',
    );
  }
}

/** Later entries override earlier ones by name, case-insensitively (GitHub semantics). */
function mergeLabelEntries(base: ConfigEntry[], overlay: ConfigEntry[]): ConfigEntry[] {
  const merged = [...base];
  const indexByName = new Map(base.map((entry, i) => [entry.name.toLowerCase(), i] as const));
  for (const entry of overlay) {
    const key = entry.name.toLowerCase();
    const at = indexByName.get(key);
    if (at === undefined) {
      indexByName.set(key, merged.length);
      merged.push(entry);
    } else {
      merged[at] = entry;
    }
  }
  return merged;
}

/**
 * Per-file alias invariants were checked at parse time, so a violation here
 * means two extended configs contradict each other across files.
 */
function validateMergedAliases(labels: ConfigEntry[]): void {
  const hint =
    "The extended configs contradict each other; override one of the entries in the extending config.";
  const names = new Set(labels.map((label) => label.name.toLowerCase()));
  const aliasOwner = new Map<string, string>();
  for (const label of labels) {
    if (isLabelDeletion(label)) {
      continue;
    }
    for (const alias of label.aliases ?? []) {
      const key = alias.toLowerCase();
      if (names.has(key)) {
        throw new ConfigError(
          `After merging extends: label "${label.name}": alias "${alias}" is also a declared label name`,
          hint,
        );
      }
      const owner = aliasOwner.get(key);
      if (owner !== undefined) {
        throw new ConfigError(
          `After merging extends: label "${label.name}": duplicate alias "${alias}" (also claimed by label "${owner}")`,
          hint,
        );
      }
      aliasOwner.set(key, label.name);
    }
  }
}

function remoteId(owner: string, repo: string, path: string): string {
  return `${owner.toLowerCase()}/${repo.toLowerCase()}:${path}`;
}

function assertNoExtendsCycle(stack: string[], id: string): void {
  if (stack.includes(id)) {
    throw new ConfigError(
      `Circular extends: ${[...stack, id].join(" -> ")}`,
      "A config cannot extend itself, directly or through other configs.",
    );
  }
}

function requireFetcher(fetcher: RemoteFileFetcher | undefined, spec: string): RemoteFileFetcher {
  if (!fetcher) {
    throw new ConfigError(
      `Cannot resolve extends "${spec}" without GitHub access`,
      "`validate` is offline and only resolves extends pointing at local files; use `gh-labeler plan` to check configs that extend another repository.",
    );
  }
  return fetcher;
}

/** Resolve an extends path against a directory inside a remote repository. */
function resolveRepoPath(dir: string, path: string, spec: string): string {
  const joined = path.startsWith("/") ? path.slice(1) : posix.join(dir, path);
  const normalized = posix.normalize(joined);
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new ConfigError(
      `Extends path escapes the repository: "${spec}"`,
      "Paths in a config fetched from a repository resolve inside that same repository.",
    );
  }
  return normalized;
}

interface LoadedBase {
  config: LabelConfigFile;
  origin: ConfigOrigin;
  id: string;
}

async function loadExtendsBase(
  spec: string,
  origin: ConfigOrigin,
  fetcher: RemoteFileFetcher | undefined,
): Promise<LoadedBase> {
  const ref = parseExtendsRef(spec);

  if (ref.kind === "path") {
    if (origin.kind === "local") {
      const path = resolve(origin.dir, ref.path);
      if (!existsSync(path)) {
        throw new ConfigError(
          `Extends target not found: ${path}`,
          `Referenced as "${spec}" from the extending config.`,
        );
      }
      return {
        config: loadConfigFile(path),
        origin: { kind: "local", dir: dirname(path) },
        id: path,
      };
    }
    const path = resolveRepoPath(origin.dir, ref.path, spec);
    const { config } = await fetchRemoteConfigFile(requireFetcher(fetcher, spec), {
      owner: origin.owner,
      repo: origin.repo,
      path,
    });
    return {
      config,
      origin: { kind: "remote", owner: origin.owner, repo: origin.repo, dir: posix.dirname(path) },
      id: remoteId(origin.owner, origin.repo, path),
    };
  }

  const { config, path } = await fetchRemoteConfigFile(requireFetcher(fetcher, spec), ref);
  return {
    config,
    origin: { kind: "remote", owner: ref.owner, repo: ref.repo, dir: posix.dirname(path) },
    id: remoteId(ref.owner, ref.repo, path),
  };
}

async function resolveExtendsChain(
  config: LabelConfigFile,
  origin: ConfigOrigin,
  fetcher: RemoteFileFetcher | undefined,
  stack: string[],
): Promise<ConfigEntry[]> {
  let merged: ConfigEntry[] = [];
  for (const spec of config.extends ?? []) {
    // Sequential by design: merge order must follow the extends order, and
    // cycle detection tracks the current chain.
    // eslint-disable-next-line no-await-in-loop
    const base = await loadExtendsBase(spec, origin, fetcher);
    assertNoExtendsCycle(stack, base.id);
    // eslint-disable-next-line no-await-in-loop
    const baseLabels = await resolveExtendsChain(base.config, base.origin, fetcher, [
      ...stack,
      base.id,
    ]);
    merged = mergeLabelEntries(merged, baseLabels);
  }
  return mergeLabelEntries(merged, config.labels);
}

async function resolveExtendedConfig(
  config: LabelConfigFile,
  origin: ConfigOrigin,
  fetcher: RemoteFileFetcher | undefined,
  stack: string[],
): Promise<LabelConfigFile> {
  if (!config.extends || config.extends.length === 0) {
    return config;
  }
  const labels = await resolveExtendsChain(config, origin, fetcher, stack);
  validateMergedAliases(labels);
  const resolved: LabelConfigFile = { labels };
  // Deliberately not inheriting prune: a shared base config must not be able
  // to switch on deletions for every repository that extends it.
  if (config.prune !== undefined) {
    resolved.prune = config.prune;
  }
  return resolved;
}

/**
 * Resolve a locally loaded config's `extends` chain. `configPath` is null for
 * stdin (paths then resolve against the working directory). Remote refs need
 * a fetcher; without one they fail with a config error.
 */
export function resolveConfigExtends(
  config: LabelConfigFile,
  configPath: string | null,
  fetcher?: RemoteFileFetcher,
): Promise<LabelConfigFile> {
  const path = configPath === null ? null : resolve(configPath);
  const origin: ConfigOrigin = {
    kind: "local",
    dir: path === null ? process.cwd() : dirname(path),
  };
  return resolveExtendedConfig(config, origin, fetcher, path === null ? [] : [path]);
}
