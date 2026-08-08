import pc from "picocolors";
import { type FieldChange, type PlannedOperation } from "#core/planner.js";
import { type SyncReport } from "#core/syncer.js";

function formatChange(change: FieldChange): string {
  const from = change.from ?? "(none)";
  const to = change.to ?? "(none)";
  return `${change.field} ${from} → ${to}`;
}

export function formatOperation(op: PlannedOperation): string {
  switch (op.type) {
    case "create": {
      const description = op.label.description ? `  ${pc.dim(op.label.description)}` : "";
      return `  ${pc.green("+")} create  ${pc.bold(op.label.name)}  ${op.label.color}${description}`;
    }
    case "update": {
      const changes = op.changes.map(formatChange).join(", ");
      return `  ${pc.yellow("~")} update  ${pc.bold(op.name)}  ${pc.dim(`(${changes})`)}`;
    }
    case "rename": {
      const via = op.matchedBy === "alias" ? "alias" : "similar name";
      return `  ${pc.cyan("→")} rename  ${pc.bold(op.from)} → ${pc.bold(op.to)}  ${pc.dim(`(matched by ${via})`)}`;
    }
    case "delete": {
      const reason = op.reason === "flagged" ? "flagged in config" : "not in config (--prune)";
      return `  ${pc.red("-")} delete  ${pc.bold(op.name)}  ${pc.dim(`(${reason})`)}`;
    }
    case "keep": {
      return `  ${pc.dim("=")} keep    ${pc.dim(op.name)}`;
    }
  }
}

function summaryLine(report: SyncReport): string {
  const s = report.summary;
  const parts = [
    s.created > 0 ? pc.green(`${s.created} to create`) : null,
    s.updated > 0 ? pc.yellow(`${s.updated} to update`) : null,
    s.renamed > 0 ? pc.cyan(`${s.renamed} to rename`) : null,
    s.deleted > 0 ? pc.red(`${s.deleted} to delete`) : null,
    s.kept > 0 ? pc.dim(`${s.kept} unchanged`) : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(", ") : pc.dim("nothing to do");
}

/** Render a plan (dry-run) for humans. Keeps are collapsed into the summary. */
export function renderPlan(report: SyncReport): string[] {
  const lines: string[] = [`Plan for ${pc.bold(report.repository)}:`, ""];

  const visible = report.operations.filter((op) => op.type !== "keep");
  if (visible.length === 0) {
    lines.push(`  ${pc.green("✔")} Already in sync — no changes needed.`);
  } else {
    for (const op of visible) {
      lines.push(formatOperation(op));
    }
  }

  lines.push("", `Summary: ${summaryLine(report)}`);

  if (report.unmanaged.length > 0) {
    lines.push(
      pc.dim(
        `Not managed by config (left untouched): ${report.unmanaged.join(", ")} — pass --prune to delete them.`,
      ),
    );
  }

  return lines;
}

/** Render the outcome after execution. */
export function renderResult(report: SyncReport): string[] {
  const lines: string[] = [];

  if (report.status === "no_changes") {
    lines.push(`${pc.green("✔")} ${pc.bold(report.repository)} is already in sync.`);
  } else {
    const s = report.summary;
    const parts = [
      s.created > 0 ? pc.green(`${s.created} created`) : null,
      s.updated > 0 ? pc.yellow(`${s.updated} updated`) : null,
      s.renamed > 0 ? pc.cyan(`${s.renamed} renamed`) : null,
      s.deleted > 0 ? pc.red(`${s.deleted} deleted`) : null,
      s.kept > 0 ? pc.dim(`${s.kept} unchanged`) : null,
    ].filter((part): part is string => part !== null);
    lines.push(`${pc.green("✔")} Synced ${pc.bold(report.repository)}: ${parts.join(", ")}`);
  }

  if (report.failures.length > 0) {
    lines.push("", pc.red(`${report.failures.length} operation(s) failed:`));
    for (const failure of report.failures) {
      lines.push(pc.red(`  ✖ ${describeOperation(failure.operation)}: ${failure.error}`));
    }
  }

  if (report.unmanaged.length > 0) {
    lines.push(
      pc.dim(
        `Not managed by config (left untouched): ${report.unmanaged.join(", ")} — pass --prune to delete them.`,
      ),
    );
  }

  return lines;
}

function describeOperation(op: PlannedOperation): string {
  switch (op.type) {
    case "create": {
      return `create "${op.label.name}"`;
    }
    case "update": {
      return `update "${op.name}"`;
    }
    case "rename": {
      return `rename "${op.from}" → "${op.to}"`;
    }
    case "delete": {
      return `delete "${op.name}"`;
    }
    case "keep": {
      return `keep "${op.name}"`;
    }
  }
}
