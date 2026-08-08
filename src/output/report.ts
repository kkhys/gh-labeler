import { type GhLabelerError } from "#errors.js";
import { type LabelSpec } from "#core/labels.js";
import { type PlannedOperation } from "#core/planner.js";
import { type OperationFailure, type SyncReport } from "#core/syncer.js";

/**
 * Version of the machine-readable output envelope. Bump only on breaking
 * shape changes; agents and scripts key off this.
 */
export const REPORT_SCHEMA_VERSION = 2;

type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
// A type alias cannot circularly reference itself through Record; an interface
// defers resolution, so the index-signature form is required here.
// eslint-disable-next-line typescript/consistent-indexed-object-style
interface JsonObject {
  [key: string]: JsonValue;
}

function serializeLabel(label: LabelSpec): JsonObject {
  const out: JsonObject = { name: label.name, color: label.color };
  if (label.description !== undefined) {
    out["description"] = label.description;
  }
  if (label.aliases !== undefined && label.aliases.length > 0) {
    out["aliases"] = [...label.aliases];
  }
  return out;
}

export function serializeOperation(op: PlannedOperation): JsonObject {
  switch (op.type) {
    case "create": {
      return { type: "create", label: serializeLabel(op.label) };
    }
    case "update": {
      return {
        type: "update",
        name: op.name,
        label: serializeLabel(op.label),
        changes: op.changes.map((c) => ({
          field: c.field,
          from: c.from,
          to: c.to,
        })),
      };
    }
    case "rename": {
      return {
        type: "rename",
        from: op.from,
        to: op.to,
        matched_by: op.matchedBy,
        label: serializeLabel(op.label),
      };
    }
    case "delete": {
      return { type: "delete", name: op.name, reason: op.reason };
    }
    case "keep": {
      return { type: "keep", name: op.name };
    }
  }
}

function serializeFailure(failure: OperationFailure): JsonObject {
  return {
    operation: serializeOperation(failure.operation),
    error: failure.error,
  };
}

/** Structured result envelope for `--json` mode and MCP tools. */
export function reportEnvelope(command: string, report: SyncReport): JsonObject {
  return {
    schema_version: REPORT_SCHEMA_VERSION,
    command,
    repository: report.repository,
    status: report.status,
    dry_run: report.dryRun,
    exit_code: report.exitCode,
    summary: {
      created: report.summary.created,
      updated: report.summary.updated,
      renamed: report.summary.renamed,
      deleted: report.summary.deleted,
      kept: report.summary.kept,
    },
    operations: report.operations.map(serializeOperation),
    unmanaged: [...report.unmanaged],
    failures: report.failures.map(serializeFailure),
    idempotent: report.idempotent,
  };
}

/** Structured error envelope; every failure mode is machine-readable. */
export function errorEnvelope(command: string, err: GhLabelerError): JsonObject {
  const error: JsonObject = { code: err.code, message: err.message };
  if (err.hint !== undefined) {
    error["hint"] = err.hint;
  }
  return {
    schema_version: REPORT_SCHEMA_VERSION,
    command,
    status: "error",
    exit_code: err.exitCode,
    error,
  };
}
