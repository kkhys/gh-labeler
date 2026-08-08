import { describe, expect, it } from "vitest";
import { ConfigError } from "#errors.js";
import { defaultLabels, isValidHexColor, normalizeColor, validateLabelSpec } from "#core/labels.js";

describe(isValidHexColor, () => {
  it("accepts 6-digit hex without #", () => {
    expect(isValidHexColor("ff0000")).toBe(true);
    expect(isValidHexColor("00FF00")).toBe(true);
    expect(isValidHexColor("123abc")).toBe(true);
  });

  it("rejects invalid values", () => {
    expect(isValidHexColor("ff00")).toBe(false);
    expect(isValidHexColor("ff0000x")).toBe(false);
    expect(isValidHexColor("#ff0000")).toBe(false);
    expect(isValidHexColor("abc")).toBe(false);
  });
});

describe(normalizeColor, () => {
  it("strips the # prefix and lowercases", () => {
    expect(normalizeColor("#FF0000")).toBe("ff0000");
    expect(normalizeColor("d73a4a")).toBe("d73a4a");
  });
});

describe(validateLabelSpec, () => {
  it("accepts a minimal valid label", () => {
    const spec = validateLabelSpec({ name: "bug", color: "#ff0000" }, "labels[0]");
    expect(spec).toStrictEqual({ name: "bug", color: "#ff0000" });
  });

  it("accepts all optional fields; delete: false yields a plain label", () => {
    const spec = validateLabelSpec(
      {
        name: "bug",
        color: "#ff0000",
        description: "A bug",
        aliases: ["defect"],
        delete: false,
      },
      "labels[0]",
    );
    expect(spec).toStrictEqual({
      name: "bug",
      color: "#ff0000",
      description: "A bug",
      aliases: ["defect"],
    });
  });

  it("accepts a deletion entry without a color", () => {
    const spec = validateLabelSpec({ name: "wontfix", delete: true }, "labels[0]");
    expect(spec).toStrictEqual({ name: "wontfix", delete: true });
  });

  it("tolerates label fields on a deletion entry but drops them", () => {
    const spec = validateLabelSpec(
      { name: "wontfix", color: "#ff0000", description: "old", delete: true },
      "labels[0]",
    );
    expect(spec).toStrictEqual({ name: "wontfix", delete: true });
  });

  it("still rejects an invalid color on a deletion entry", () => {
    expect(() =>
      validateLabelSpec({ name: "wontfix", color: "red", delete: true }, "labels[0]"),
    ).toThrow(ConfigError);
  });

  it("requires a color unless delete is true", () => {
    expect(() => validateLabelSpec({ name: "bug" }, "labels[0]")).toThrow(/"color" is required/u);
    expect(() => validateLabelSpec({ name: "bug", delete: false }, "labels[0]")).toThrow(
      ConfigError,
    );
  });

  it("rejects non-object entries", () => {
    expect(() => validateLabelSpec("bug", "labels[0]")).toThrow(ConfigError);
    expect(() => validateLabelSpec(null, "labels[0]")).toThrow(ConfigError);
  });

  it("rejects an empty name", () => {
    expect(() => validateLabelSpec({ name: "  ", color: "#ff0000" }, "labels[0]")).toThrow(
      ConfigError,
    );
  });

  it("requires the # prefix on colors", () => {
    expect(() => validateLabelSpec({ name: "bug", color: "ff0000" }, "labels[0]")).toThrow(
      ConfigError,
    );
  });

  it("rejects 3-digit shorthand colors", () => {
    expect(() => validateLabelSpec({ name: "bug", color: "#abc" }, "labels[0]")).toThrow(
      ConfigError,
    );
  });

  it("rejects non-hex colors", () => {
    expect(() => validateLabelSpec({ name: "bug", color: "#invalid" }, "labels[0]")).toThrow(
      ConfigError,
    );
  });

  it("includes the location in error messages", () => {
    expect(() => validateLabelSpec({ name: "bug", color: "bad" }, "labels[3]")).toThrow(
      /labels\[3\]/u,
    );
  });

  it("accepts a description of exactly 100 characters", () => {
    const spec = validateLabelSpec(
      { name: "bug", color: "#ff0000", description: "a".repeat(100) },
      "labels[0]",
    );
    expect(spec).toMatchObject({ description: "a".repeat(100) });
  });

  it("rejects a description over 100 characters", () => {
    expect(() =>
      validateLabelSpec(
        { name: "bug", color: "#ff0000", description: "a".repeat(101) },
        "labels[0]",
      ),
    ).toThrow(/100 characters/u);
  });

  it("counts description length in code points, not UTF-16 units", () => {
    // 100 emoji = 200 UTF-16 units but exactly 100 characters on GitHub.
    const description = "😀".repeat(100);
    const spec = validateLabelSpec({ name: "bug", color: "#ff0000", description }, "labels[0]");
    expect(spec).toMatchObject({ description });
  });
});

describe(defaultLabels, () => {
  it("provides a valid starter set", () => {
    const labels = defaultLabels();
    expect(labels.length).toBeGreaterThan(0);
    for (const [i, label] of labels.entries()) {
      expect(validateLabelSpec(label, `labels[${i}]`)).toStrictEqual(label);
    }
  });

  it("includes the classic GitHub defaults", () => {
    const names = defaultLabels().map((label) => label.name);
    expect(names).toContain("bug");
    expect(names).toContain("enhancement");
    expect(names).toContain("good first issue");
  });
});
