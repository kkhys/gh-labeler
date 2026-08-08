import { type GitHubLabel } from "#github/client.js";
import { type ConfigEntry, isLabelDeletion, type LabelSpec, normalizeColor } from "#core/labels.js";
import { calculateLabelSimilarity, SIMILARITY_THRESHOLD } from "#core/similarity.js";

export interface FieldChange {
  field: "name" | "color" | "description";
  from: string | null;
  to: string | null;
}

export type PlannedOperation =
  | { type: "create"; label: LabelSpec }
  | { type: "update"; name: string; label: LabelSpec; changes: FieldChange[] }
  | {
      type: "rename";
      from: string;
      to: string;
      label: LabelSpec;
      matchedBy: "alias" | "similarity";
    }
  | { type: "delete"; name: string; reason: "flagged" | "pruned" }
  | { type: "keep"; name: string };

export interface PlanOptions {
  /** Delete repository labels absent from the config. Default: false (safe). */
  prune?: boolean;
  /**
   * Similarity-based rename detection (matching step 3). Default: true.
   * Disable for fully deterministic plans in unattended runs; alias matching
   * is explicit and always stays on.
   */
  similarity?: boolean;
}

export interface PlanResult {
  operations: PlannedOperation[];
  /** Repository labels not covered by the config and not deleted (prune off). */
  unmanaged: string[];
}

/**
 * GitHub label names are case-insensitively unique, so exact and alias
 * matching key on this. Lowercased keys cannot collide across current labels.
 */
function nameKey(name: string): string {
  return name.toLowerCase();
}

/**
 * Pure planning: no side effects, no API calls.
 *
 * Matching priority (strict order, never reorder):
 * 1. delete flag / exact name match → delete, keep, or update
 * 2. alias match → rename
 * 3. similarity match (> SIMILARITY_THRESHOLD) → rename
 * 4. no match → create
 *
 * Steps 1–2 match names case-insensitively, mirroring GitHub. Each step runs
 * as a global phase over the whole config, not per label in config order: a
 * rename for one entry must never consume a current label that another entry
 * names exactly or flags for deletion. Operations are still emitted in config
 * order.
 */
export function planSync(
  current: GitHubLabel[],
  desired: ConfigEntry[],
  options: PlanOptions = {},
): PlanResult {
  const currentByKey = new Map(current.map((label) => [nameKey(label.name), label]));
  const consumed = new Set<string>();
  const slots: (PlannedOperation | null)[] = desired.map(() => null);

  // Phase 1: delete flags and exact name matches consume their labels first.
  for (const [i, spec] of desired.entries()) {
    const key = nameKey(spec.name);
    const exact = currentByKey.get(key);
    if (!exact || consumed.has(key)) {
      continue;
    }
    consumed.add(key);
    slots[i] = isLabelDeletion(spec)
      ? { type: "delete", name: exact.name, reason: "flagged" }
      : diffLabel(exact, spec);
  }

  // Phase 2: alias renames. Aliases are explicit, so they outrank every
  // similarity match, including those of earlier entries.
  for (const [i, spec] of desired.entries()) {
    if (slots[i] || isLabelDeletion(spec)) {
      continue;
    }
    for (const alias of spec.aliases ?? []) {
      const key = nameKey(alias);
      const target = currentByKey.get(key);
      if (!target || consumed.has(key)) {
        continue;
      }
      consumed.add(key);
      slots[i] = {
        type: "rename",
        from: target.name,
        to: spec.name,
        label: spec,
        matchedBy: "alias",
      };
      break;
    }
  }

  // Phase 3: similarity renames, falling back to create.
  for (const [i, spec] of desired.entries()) {
    if (slots[i] || isLabelDeletion(spec)) {
      continue;
    }
    const similar =
      (options.similarity ?? true) ? findSimilarLabel(current, consumed, spec.name) : null;
    if (similar) {
      consumed.add(nameKey(similar.name));
      slots[i] = {
        type: "rename",
        from: similar.name,
        to: spec.name,
        label: spec,
        matchedBy: "similarity",
      };
      continue;
    }
    slots[i] = { type: "create", label: spec };
  }

  const operations = slots.filter((op): op is PlannedOperation => op !== null);

  const leftover = current.filter((label) => !consumed.has(nameKey(label.name)));
  if (options.prune) {
    for (const label of leftover) {
      operations.push({ type: "delete", name: label.name, reason: "pruned" });
    }
    return { operations, unmanaged: [] };
  }

  return { operations, unmanaged: leftover.map((label) => label.name) };
}

function diffLabel(current: GitHubLabel, spec: LabelSpec): PlannedOperation {
  const changes: FieldChange[] = [];

  // Exact matching ignores case, so a name difference here is a casing fix;
  // it rides the same atomic PATCH as any other field change.
  if (current.name !== spec.name) {
    changes.push({ field: "name", from: current.name, to: spec.name });
  }

  if (normalizeColor(current.color) !== normalizeColor(spec.color)) {
    changes.push({
      field: "color",
      from: `#${normalizeColor(current.color)}`,
      to: spec.color,
    });
  }

  const currentDescription = current.description ?? "";
  const desiredDescription = spec.description ?? "";
  if (currentDescription !== desiredDescription) {
    changes.push({
      field: "description",
      from: current.description,
      to: spec.description ?? null,
    });
  }

  if (changes.length === 0) {
    return { type: "keep", name: current.name };
  }
  return { type: "update", name: current.name, label: spec, changes };
}

function findSimilarLabel(
  current: GitHubLabel[],
  consumed: Set<string>,
  targetName: string,
): GitHubLabel | null {
  let best: GitHubLabel | null = null;
  let bestSimilarity = SIMILARITY_THRESHOLD;

  for (const label of current) {
    if (consumed.has(nameKey(label.name))) {
      continue;
    }
    const similarity = calculateLabelSimilarity(label.name, targetName);
    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;
      best = label;
    }
  }

  return best;
}
