import { describe, expect, it } from "vitest";
import { ConfigError } from "#errors.js";
import { planSync } from "#core/planner.js";
import {
  errorEnvelope,
  REPORT_SCHEMA_VERSION,
  reportEnvelope,
  serializeOperation,
} from "#output/report.js";
import { buildReport } from "#core/syncer.js";
import { makeGitHubLabel, makeLabelSpec } from "./helpers.js";

describe(serializeOperation, () => {
  it("serializes create", () => {
    expect(
      serializeOperation({
        type: "create",
        label: makeLabelSpec("bug", "#ff0000"),
      }),
    ).toStrictEqual({
      type: "create",
      label: { name: "bug", color: "#ff0000" },
    });
  });

  it("omits undefined label fields", () => {
    const serialized = serializeOperation({
      type: "create",
      label: { name: "bug", color: "#ff0000" },
    });
    expect(serialized["label"]).not.toHaveProperty("description");
    expect(serialized["label"]).not.toHaveProperty("aliases");
  });

  it("serializes update with structured changes", () => {
    expect(
      serializeOperation({
        type: "update",
        name: "bug",
        label: makeLabelSpec("bug", "#00ff00"),
        changes: [{ field: "color", from: "#ff0000", to: "#00ff00" }],
      }),
    ).toStrictEqual({
      type: "update",
      name: "bug",
      label: { name: "bug", color: "#00ff00" },
      changes: [{ field: "color", from: "#ff0000", to: "#00ff00" }],
    });
  });

  it("serializes rename with matched_by in snake_case", () => {
    const serialized = serializeOperation({
      type: "rename",
      from: "defect",
      to: "bug",
      label: makeLabelSpec("bug", "#ff0000"),
      matchedBy: "alias",
    });
    expect(serialized).toMatchObject({
      type: "rename",
      from: "defect",
      to: "bug",
      matched_by: "alias",
    });
  });

  it("serializes delete and keep", () => {
    expect(serializeOperation({ type: "delete", name: "old", reason: "pruned" })).toStrictEqual({
      type: "delete",
      name: "old",
      reason: "pruned",
    });
    expect(serializeOperation({ type: "keep", name: "bug" })).toStrictEqual({
      type: "keep",
      name: "bug",
    });
  });
});

describe(reportEnvelope, () => {
  it("produces a stable snake_case envelope", () => {
    const plan = planSync([makeGitHubLabel("extra", "ffffff")], [makeLabelSpec("bug", "#d73a4a")]);
    const report = buildReport({
      repository: "o/r",
      plan,
      failures: [],
      dryRun: true,
    });
    const envelope = reportEnvelope("plan", report);

    expect(envelope).toMatchObject({
      schema_version: REPORT_SCHEMA_VERSION,
      command: "plan",
      repository: "o/r",
      status: "success",
      dry_run: true,
      exit_code: 0,
      summary: { created: 1, updated: 0, renamed: 0, deleted: 0, kept: 0 },
      unmanaged: ["extra"],
      failures: [],
      idempotent: false,
    });
    expect(Array.isArray(envelope["operations"])).toBe(true);
  });

  it("round-trips through JSON", () => {
    const plan = planSync([], [makeLabelSpec("bug", "#d73a4a")]);
    const report = buildReport({
      repository: "o/r",
      plan,
      failures: [],
      dryRun: false,
    });
    // The JSON round-trip is what's under test, not cloning.
    // eslint-disable-next-line unicorn/prefer-structured-clone
    const parsed = JSON.parse(JSON.stringify(reportEnvelope("sync", report)));
    expect(parsed.command).toBe("sync");
    expect(parsed.operations[0].type).toBe("create");
  });

  it("serializes failures with their operations", () => {
    const plan = planSync([], [makeLabelSpec("bug", "#d73a4a")]);
    const failures = plan.operations.map((operation) => ({
      operation,
      error: "boom",
    }));
    const report = buildReport({
      repository: "o/r",
      plan,
      failures,
      dryRun: false,
    });
    const envelope = reportEnvelope("sync", report);

    expect(envelope["status"]).toBe("partial_failure");
    expect(envelope["exit_code"]).toBe(5);
    expect(envelope["failures"]).toStrictEqual([
      {
        operation: { type: "create", label: { name: "bug", color: "#d73a4a" } },
        error: "boom",
      },
    ]);
  });
});

describe(errorEnvelope, () => {
  it("includes code, message, and hint", () => {
    const envelope = errorEnvelope("sync", new ConfigError("bad config", "fix it"));
    expect(envelope).toStrictEqual({
      schema_version: REPORT_SCHEMA_VERSION,
      command: "sync",
      status: "error",
      exit_code: 2,
      error: { code: "config_error", message: "bad config", hint: "fix it" },
    });
  });

  it("omits a missing hint", () => {
    const envelope = errorEnvelope("sync", new ConfigError("bad config"));
    expect(envelope["error"]).not.toHaveProperty("hint");
  });
});
