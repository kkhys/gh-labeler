import { EXIT_CODES, type ExitCode } from "#errors.js";
import { type LabelService } from "#github/client.js";
import { type PlannedOperation, type PlanResult } from "#core/planner.js";

export interface SummaryCounts {
  created: number;
  updated: number;
  renamed: number;
  deleted: number;
  kept: number;
}

export interface OperationFailure {
  operation: PlannedOperation;
  error: string;
}

export type SyncStatus = "success" | "no_changes" | "partial_failure";

export interface SyncReport {
  repository: string;
  dryRun: boolean;
  operations: PlannedOperation[];
  unmanaged: string[];
  failures: OperationFailure[];
  summary: SummaryCounts;
  status: SyncStatus;
  exitCode: ExitCode;
  /** True when the repository already matched the config exactly. */
  idempotent: boolean;
}

export function summarizePlan(operations: PlannedOperation[]): SummaryCounts {
  const summary: SummaryCounts = {
    created: 0,
    updated: 0,
    renamed: 0,
    deleted: 0,
    kept: 0,
  };
  for (const op of operations) {
    switch (op.type) {
      case "create": {
        summary.created += 1;
        break;
      }
      case "update": {
        summary.updated += 1;
        break;
      }
      case "rename": {
        summary.renamed += 1;
        break;
      }
      case "delete": {
        summary.deleted += 1;
        break;
      }
      case "keep": {
        summary.kept += 1;
        break;
      }
    }
  }
  return summary;
}

export function hasChanges(summary: SummaryCounts): boolean {
  return summary.created + summary.updated + summary.renamed + summary.deleted > 0;
}

/**
 * Execute a plan sequentially (gentle on the API rate limit), continuing
 * past individual failures. Dry-run executes nothing.
 */
export async function applyPlan(
  service: LabelService,
  operations: PlannedOperation[],
  options: { dryRun?: boolean } = {},
): Promise<OperationFailure[]> {
  if (options.dryRun) {
    return [];
  }

  const failures: OperationFailure[] = [];
  for (const operation of operations) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await executeOperation(service, operation);
    } catch (error) {
      failures.push({
        operation,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return failures;
}

async function executeOperation(service: LabelService, operation: PlannedOperation): Promise<void> {
  switch (operation.type) {
    case "create": {
      await service.createLabel(operation.label);
      break;
    }
    case "update": {
      await service.updateLabel(operation.name, operation.label);
      break;
    }
    case "rename": {
      await service.updateLabel(operation.from, operation.label);
      break;
    }
    case "delete": {
      await service.deleteLabel(operation.name);
      break;
    }
    case "keep": {
      break;
    }
  }
}

export function buildReport(input: {
  repository: string;
  plan: PlanResult;
  failures: OperationFailure[];
  dryRun: boolean;
}): SyncReport {
  const summary = summarizePlan(input.plan.operations);
  const failed = input.failures.length > 0;
  const changed = hasChanges(summary);

  let status: SyncStatus;
  if (failed) {
    status = "partial_failure";
  } else if (changed) {
    status = "success";
  } else {
    status = "no_changes";
  }

  return {
    repository: input.repository,
    dryRun: input.dryRun,
    operations: input.plan.operations,
    unmanaged: input.plan.unmanaged,
    failures: input.failures,
    summary,
    status,
    exitCode: failed ? EXIT_CODES.PARTIAL_FAILURE : EXIT_CODES.SUCCESS,
    idempotent: !failed && !changed,
  };
}
