import { describe, expect, it } from "vitest";
import { EXIT_CODES } from "#errors.js";
import { type LabelService } from "#github/client.js";
import { type PlanResult, planSync } from "#core/planner.js";
import { applyPlan, buildReport, type SyncReport, summarizePlan } from "#core/syncer.js";
import {
  FailingLabelService,
  MockLabelService,
  makeGitHubLabel,
  makeLabelSpec,
} from "./helpers.js";

/** Mirrors the CLI's apply path: execute the plan, then build the report. */
async function runPlan(
  service: LabelService,
  plan: PlanResult,
  options: { dryRun?: boolean } = {},
): Promise<SyncReport> {
  const failures = await applyPlan(service, plan.operations, options);
  return buildReport({
    repository: "o/r",
    plan,
    failures,
    dryRun: options.dryRun ?? false,
  });
}

describe(summarizePlan, () => {
  it("counts every operation type", () => {
    const summary = summarizePlan([
      { type: "create", label: makeLabelSpec("a", "#ff0000") },
      {
        type: "update",
        name: "b",
        label: makeLabelSpec("b", "#00ff00"),
        changes: [],
      },
      {
        type: "rename",
        from: "c",
        to: "d",
        label: makeLabelSpec("d", "#0000ff"),
        matchedBy: "alias",
      },
      { type: "delete", name: "e", reason: "pruned" },
      { type: "keep", name: "f" },
    ]);
    expect(summary).toStrictEqual({
      created: 1,
      updated: 1,
      renamed: 1,
      deleted: 1,
      kept: 1,
    });
  });
});

describe(applyPlan, () => {
  it("creates all labels in an empty repository", async () => {
    const service = new MockLabelService();
    const plan = planSync(
      [],
      [makeLabelSpec("bug", "#d73a4a", "Bug"), makeLabelSpec("feature", "#a2eeef")],
    );

    const report = await runPlan(service, plan);

    expect(report.summary.created).toBe(2);
    expect(report.status).toBe("success");
    expect(report.exitCode).toBe(EXIT_CODES.SUCCESS);
    expect(service.labels.map((l) => l.name).toSorted()).toStrictEqual(["bug", "feature"]);
  });

  it("does not touch the service in dry-run mode", async () => {
    const service = new MockLabelService();
    const plan = planSync([], [makeLabelSpec("bug", "#d73a4a")]);

    const report = await runPlan(service, plan, { dryRun: true });

    expect(report.dryRun).toBe(true);
    expect(report.summary.created).toBe(1);
    expect(service.labels).toStrictEqual([]);
  });

  it("creates and prunes in one pass", async () => {
    const service = new MockLabelService([makeGitHubLabel("old-label", "ffffff")]);
    const plan = planSync(await service.listLabels(), [makeLabelSpec("new-label", "#d73a4a")], {
      prune: true,
    });

    const report = await runPlan(service, plan);

    expect(report.summary.created).toBe(1);
    expect(report.summary.deleted).toBe(1);
    expect(service.labels).toHaveLength(1);
    expect(service.labels[0]?.name).toBe("new-label");
  });

  it("renames via alias end to end", async () => {
    const service = new MockLabelService([makeGitHubLabel("defect", "d73a4a")]);
    const plan = planSync(await service.listLabels(), [
      { name: "bug", color: "#d73a4a", aliases: ["defect"] },
    ]);

    const report = await runPlan(service, plan);

    expect(report.summary.renamed).toBe(1);
    expect(service.labels).toHaveLength(1);
    expect(service.labels[0]?.name).toBe("bug");
  });

  it("collects failures and reports partial_failure", async () => {
    const service = new FailingLabelService();
    const plan = planSync([], [makeLabelSpec("bug", "#d73a4a")]);

    const report = await runPlan(service, plan);

    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]?.error).toContain("mock create error");
    expect(report.status).toBe("partial_failure");
    expect(report.exitCode).toBe(EXIT_CODES.PARTIAL_FAILURE);
    expect(report.idempotent).toBe(false);
  });

  it("continues past failures", async () => {
    const service = new FailingLabelService();
    const plan = planSync([], [makeLabelSpec("a", "#d73a4a"), makeLabelSpec("b", "#a2eeef")]);

    const failures = await applyPlan(service, plan.operations);

    expect(failures).toHaveLength(2);
  });

  it("keep operations never call the service", async () => {
    const service = new FailingLabelService([makeGitHubLabel("bug", "d73a4a", "Bug")]);
    const plan = planSync(await service.listLabels(), [makeLabelSpec("bug", "#d73a4a", "Bug")]);

    const report = await runPlan(service, plan);

    expect(report.failures).toStrictEqual([]);
    expect(report.status).toBe("no_changes");
  });

  it("reports an idempotent no_changes state", async () => {
    const service = new MockLabelService([makeGitHubLabel("bug", "d73a4a", "Bug")]);
    const plan = planSync(await service.listLabels(), [makeLabelSpec("bug", "#d73a4a", "Bug")]);

    const report = await runPlan(service, plan);

    expect(report.status).toBe("no_changes");
    expect(report.idempotent).toBe(true);
    expect(report.exitCode).toBe(EXIT_CODES.SUCCESS);
  });
});

describe(buildReport, () => {
  it("carries unmanaged labels through", () => {
    const plan = planSync(
      [makeGitHubLabel("bug", "d73a4a"), makeGitHubLabel("extra", "ffffff")],
      [makeLabelSpec("bug", "#d73a4a")],
    );
    const report = buildReport({
      repository: "o/r",
      plan,
      failures: [],
      dryRun: true,
    });
    expect(report.unmanaged).toStrictEqual(["extra"]);
  });
});
