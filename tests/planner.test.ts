import { describe, expect, it } from "vitest";
import { type ConfigEntry, type LabelSpec } from "#core/labels.js";
import { planSync } from "#core/planner.js";
import { makeGitHubLabel, makeLabelSpec } from "./helpers.js";

describe(planSync, () => {
  it("creates everything for an empty repository", () => {
    const { operations } = planSync([], [makeLabelSpec("bug", "#d73a4a", "Bug")]);
    expect(operations).toStrictEqual([
      { type: "create", label: makeLabelSpec("bug", "#d73a4a", "Bug") },
    ]);
  });

  it("keeps matching labels", () => {
    const { operations } = planSync(
      [makeGitHubLabel("bug", "d73a4a", "Bug")],
      [makeLabelSpec("bug", "#d73a4a", "Bug")],
    );
    expect(operations).toStrictEqual([{ type: "keep", name: "bug" }]);
  });

  it("normalizes colors before comparing", () => {
    const { operations } = planSync(
      [makeGitHubLabel("bug", "D73A4A", "Bug")],
      [makeLabelSpec("bug", "#d73a4a", "Bug")],
    );
    expect(operations[0]?.type).toBe("keep");
  });

  it("plans an update on color change", () => {
    const { operations } = planSync(
      [makeGitHubLabel("bug", "d73a4a", "Bug")],
      [makeLabelSpec("bug", "#ff0000", "Bug")],
    );
    expect(operations[0]).toMatchObject({
      type: "update",
      name: "bug",
      changes: [{ field: "color", from: "#d73a4a", to: "#ff0000" }],
    });
  });

  it("plans an update on description change", () => {
    const { operations } = planSync(
      [makeGitHubLabel("bug", "d73a4a", "Old")],
      [makeLabelSpec("bug", "#d73a4a", "New")],
    );
    expect(operations[0]).toMatchObject({
      type: "update",
      changes: [{ field: "description", from: "Old", to: "New" }],
    });
  });

  it("collects multiple field changes in one update", () => {
    const { operations } = planSync(
      [makeGitHubLabel("bug", "d73a4a", "Old")],
      [makeLabelSpec("bug", "#ff0000", "New")],
    );
    expect(operations[0]).toMatchObject({ type: "update" });
    expect((operations[0] as { changes: unknown[] }).changes).toHaveLength(2);
  });

  it("treats a missing description and an empty one as equal", () => {
    const { operations } = planSync(
      [makeGitHubLabel("bug", "d73a4a", null)],
      [makeLabelSpec("bug", "#d73a4a")],
    );
    expect(operations[0]?.type).toBe("keep");
  });

  it("leaves extra labels unmanaged by default (prune off)", () => {
    const { operations, unmanaged } = planSync(
      [makeGitHubLabel("bug", "d73a4a"), makeGitHubLabel("extra", "ffffff")],
      [makeLabelSpec("bug", "#d73a4a")],
    );
    expect(operations.some((op) => op.type === "delete")).toBe(false);
    expect(unmanaged).toStrictEqual(["extra"]);
  });

  it("deletes extra labels when prune is on", () => {
    const { operations, unmanaged } = planSync(
      [makeGitHubLabel("bug", "d73a4a"), makeGitHubLabel("extra", "ffffff")],
      [makeLabelSpec("bug", "#d73a4a")],
      { prune: true },
    );
    expect(operations).toContainEqual({
      type: "delete",
      name: "extra",
      reason: "pruned",
    });
    expect(unmanaged).toStrictEqual([]);
  });

  it("deletes labels flagged with delete: true", () => {
    const desired: ConfigEntry[] = [{ name: "obsolete", delete: true }];
    const { operations } = planSync([makeGitHubLabel("obsolete", "d73a4a")], desired);
    expect(operations).toStrictEqual([{ type: "delete", name: "obsolete", reason: "flagged" }]);
  });

  it("ignores delete flags for labels that do not exist", () => {
    const desired: ConfigEntry[] = [{ name: "ghost", delete: true }];
    const { operations } = planSync([], desired);
    expect(operations).toStrictEqual([]);
  });

  it("applies delete flags case-insensitively, reporting the repository casing", () => {
    const desired: ConfigEntry[] = [{ name: "WONTFIX", delete: true }];
    const { operations } = planSync([makeGitHubLabel("wontfix", "d73a4a")], desired);
    expect(operations).toStrictEqual([{ type: "delete", name: "wontfix", reason: "flagged" }]);
  });

  it("matches exact names case-insensitively and fixes the casing", () => {
    const { operations } = planSync(
      [makeGitHubLabel("Bug", "d73a4a", "Bug")],
      [makeLabelSpec("bug", "#d73a4a", "Bug")],
    );
    expect(operations).toStrictEqual([
      {
        type: "update",
        name: "Bug",
        label: makeLabelSpec("bug", "#d73a4a", "Bug"),
        changes: [{ field: "name", from: "Bug", to: "bug" }],
      },
    ]);
  });

  it("keeps a label whose name matches exactly, casing included", () => {
    const { operations } = planSync(
      [makeGitHubLabel("Bug", "d73a4a", "Bug")],
      [makeLabelSpec("Bug", "#d73a4a", "Bug")],
    );
    expect(operations).toStrictEqual([{ type: "keep", name: "Bug" }]);
  });

  it("fixes casing via the exact phase even when similarity is disabled", () => {
    // Regression: a case-only difference used to fall through to create,
    // which GitHub rejects with 422 (names are case-insensitively unique).
    const { operations } = planSync(
      [makeGitHubLabel("Bug", "d73a4a")],
      [makeLabelSpec("bug", "#d73a4a")],
      { similarity: false },
    );
    expect(operations[0]).toMatchObject({
      type: "update",
      changes: [{ field: "name", from: "Bug", to: "bug" }],
    });
  });

  it("renames via alias match", () => {
    const desired: LabelSpec[] = [{ name: "bug", color: "#d73a4a", aliases: ["defect"] }];
    const { operations } = planSync([makeGitHubLabel("defect", "d73a4a")], desired);
    expect(operations).toStrictEqual([
      {
        type: "rename",
        from: "defect",
        to: "bug",
        label: desired[0],
        matchedBy: "alias",
      },
    ]);
  });

  it("matches aliases case-insensitively", () => {
    const desired: LabelSpec[] = [{ name: "bug", color: "#d73a4a", aliases: ["defect"] }];
    const { operations } = planSync([makeGitHubLabel("Defect", "d73a4a")], desired);
    expect(operations).toStrictEqual([
      {
        type: "rename",
        from: "Defect",
        to: "bug",
        label: desired[0],
        matchedBy: "alias",
      },
    ]);
  });

  it("renames via similarity match", () => {
    const { operations } = planSync(
      [makeGitHubLabel("bug-reports", "d73a4a")],
      [makeLabelSpec("bug-report", "#d73a4a")],
    );
    expect(operations[0]).toMatchObject({
      type: "rename",
      from: "bug-reports",
      to: "bug-report",
      matchedBy: "similarity",
    });
  });

  it("prefers alias over similarity", () => {
    // "bugs" is similar to "bug" (0.75 > 0.7) but the alias must win.
    const desired: LabelSpec[] = [{ name: "bug", color: "#d73a4a", aliases: ["defect"] }];
    const { operations } = planSync(
      [makeGitHubLabel("bugs", "d73a4a"), makeGitHubLabel("defect", "d73a4a")],
      desired,
    );
    expect(operations[0]).toMatchObject({
      type: "rename",
      from: "defect",
      matchedBy: "alias",
    });
  });

  it("creates instead of renaming when similarity is low", () => {
    const { operations, unmanaged } = planSync(
      [makeGitHubLabel("enhancement", "d73a4a")],
      [makeLabelSpec("bug", "#d73a4a")],
    );
    expect(operations).toStrictEqual([{ type: "create", label: makeLabelSpec("bug", "#d73a4a") }]);
    expect(unmanaged).toStrictEqual(["enhancement"]);
  });

  it("picks the most similar candidate", () => {
    const { operations } = planSync(
      [makeGitHubLabel("bug-tracker", "d73a4a"), makeGitHubLabel("bug-report", "d73a4a")],
      [makeLabelSpec("bug-reports", "#d73a4a")],
    );
    expect(operations[0]).toMatchObject({ type: "rename", from: "bug-report" });
  });

  it("creates instead of renaming when similarity matching is disabled", () => {
    const { operations, unmanaged } = planSync(
      [makeGitHubLabel("bug-reports", "d73a4a")],
      [makeLabelSpec("bug-report", "#d73a4a")],
      { similarity: false },
    );
    expect(operations).toStrictEqual([
      { type: "create", label: makeLabelSpec("bug-report", "#d73a4a") },
    ]);
    expect(unmanaged).toStrictEqual(["bug-reports"]);
  });

  it("still renames via alias when similarity matching is disabled", () => {
    const desired: LabelSpec[] = [{ name: "bug", color: "#d73a4a", aliases: ["defect"] }];
    const { operations } = planSync([makeGitHubLabel("defect", "d73a4a")], desired, {
      similarity: false,
    });
    expect(operations[0]).toMatchObject({
      type: "rename",
      from: "defect",
      matchedBy: "alias",
    });
  });

  it("never matches the same current label twice", () => {
    const desired: LabelSpec[] = [
      { name: "bug", color: "#d73a4a", aliases: ["defect"] },
      { name: "issue", color: "#0000ff", aliases: ["defect"] },
    ];
    const { operations } = planSync([makeGitHubLabel("defect", "d73a4a")], desired);
    expect(operations[0]).toMatchObject({
      type: "rename",
      from: "defect",
      to: "bug",
    });
    expect(operations[1]).toMatchObject({ type: "create" });
  });

  it("never lets an earlier similarity rename steal a later exact match", () => {
    // "priority: high" vs "priority: low" is ~0.71 similar — above the threshold.
    const { operations } = planSync(
      [makeGitHubLabel("priority: low", "00ff00")],
      [makeLabelSpec("priority: high", "#ff0000"), makeLabelSpec("priority: low", "#00ff00")],
    );
    expect(operations).toStrictEqual([
      { type: "create", label: makeLabelSpec("priority: high", "#ff0000") },
      { type: "keep", name: "priority: low" },
    ]);
  });

  it("never lets an earlier alias rename steal a later exact match", () => {
    const desired: LabelSpec[] = [
      { name: "triage", color: "#ffffff", aliases: ["needs-review"] },
      { name: "needs-review", color: "#000000" },
    ];
    const { operations } = planSync([makeGitHubLabel("needs-review", "000000")], desired);
    expect(operations).toStrictEqual([
      { type: "create", label: desired[0] },
      { type: "keep", name: "needs-review" },
    ]);
  });

  it("never lets a similarity rename override a later delete flag", () => {
    // "bugs" is 0.75 similar to "bug", but the explicit delete flag must win.
    const desired: ConfigEntry[] = [
      { name: "bug", color: "#d73a4a" },
      { name: "bugs", delete: true },
    ];
    const { operations } = planSync([makeGitHubLabel("bugs", "d73a4a")], desired);
    expect(operations).toStrictEqual([
      { type: "create", label: desired[0] },
      { type: "delete", name: "bugs", reason: "flagged" },
    ]);
  });
});
