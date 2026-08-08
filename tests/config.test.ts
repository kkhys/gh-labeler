import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONFIG_SCHEMA_URL,
  CONVENTION_CONFIG_FILES,
  detectFormatFromPath,
  fetchRemoteConfig,
  findConventionConfig,
  loadConfigFile,
  parseConfig,
  parseRemoteConfigRef,
  type RemoteFileFetcher,
  serializeConfigDocument,
} from "#config/index.js";
import { ConfigError } from "#errors.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "gh-labeler-test-"));
}

describe(detectFormatFromPath, () => {
  it("detects formats by extension", () => {
    expect(detectFormatFromPath("labels.json")).toBe("json");
    expect(detectFormatFromPath("labels.yaml")).toBe("yaml");
    expect(detectFormatFromPath(".github/labels.yml")).toBe("yaml");
  });

  it("rejects unsupported extensions", () => {
    expect(() => detectFormatFromPath("labels.toml")).toThrow(ConfigError);
    expect(() => detectFormatFromPath("Makefile")).toThrow(ConfigError);
  });
});

describe(parseConfig, () => {
  it("parses a bare JSON array", () => {
    const config = parseConfig('[{"name":"bug","color":"#ff0000"}]', "json");
    expect(config.labels).toHaveLength(1);
    expect(config.labels[0]?.name).toBe("bug");
    expect(config.prune).toBeUndefined();
  });

  it("parses a bare YAML array", () => {
    const config = parseConfig('- name: bug\n  color: "#ff0000"\n', "yaml");
    expect(config.labels).toHaveLength(1);
    expect(config.labels[0]?.name).toBe("bug");
  });

  it("parses the object form with prune", () => {
    const config = parseConfig(
      '{"labels":[{"name":"bug","color":"#ff0000"}],"prune":true}',
      "json",
    );
    expect(config.labels).toHaveLength(1);
    expect(config.prune).toBe(true);
  });

  it("ignores $schema in the object form", () => {
    const config = parseConfig(
      `{"$schema":"${CONFIG_SCHEMA_URL}","labels":[{"name":"bug","color":"#ff0000"}]}`,
      "json",
    );
    expect(config.labels).toHaveLength(1);
  });

  it("auto-detects JSON first, then YAML", () => {
    expect(parseConfig('[{"name":"a","color":"#ff0000"}]', "auto").labels).toHaveLength(1);
    expect(parseConfig('- name: a\n  color: "#ff0000"\n', "auto").labels).toHaveLength(1);
  });

  it("rejects empty input", () => {
    expect(() => parseConfig("", "auto")).toThrow(ConfigError);
    expect(() => parseConfig("   \n\t  ", "auto")).toThrow(ConfigError);
  });

  it("rejects invalid content", () => {
    expect(() => parseConfig("not json", "json")).toThrow(ConfigError);
    expect(() => parseConfig("not valid: [yaml: }{", "auto")).toThrow(ConfigError);
  });

  it("rejects objects without a labels array", () => {
    expect(() => parseConfig('{"prune":true}', "json")).toThrow(/"labels" array/u);
  });

  it("rejects a non-boolean prune", () => {
    expect(() => parseConfig('{"labels":[],"prune":"yes"}', "json")).toThrow(ConfigError);
  });

  it("validates each label", () => {
    expect(() => parseConfig('[{"name":"bug","color":"invalid"}]', "json")).toThrow(ConfigError);
  });

  it("rejects duplicate label names", () => {
    expect(() =>
      parseConfig('[{"name":"bug","color":"#ff0000"},{"name":"bug","color":"#00ff00"}]', "json"),
    ).toThrow(ConfigError);
  });

  it("rejects duplicate names differing only by case, naming both locations", () => {
    expect(() =>
      parseConfig('[{"name":"Bug","color":"#ff0000"},{"name":"bug","color":"#00ff00"}]', "json"),
    ).toThrow(/labels\[1\].*duplicate.*labels\[0\]/u);
  });

  it("rejects duplicate names in the object form", () => {
    expect(() =>
      parseConfig(
        '{"labels":[{"name":"bug","color":"#ff0000"},{"name":"bug","color":"#00ff00"}]}',
        "json",
      ),
    ).toThrow(ConfigError);
  });

  it("parses a deletion entry without a color", () => {
    const config = parseConfig('[{"name":"wontfix","delete":true}]', "json");
    expect(config.labels).toStrictEqual([{ name: "wontfix", delete: true }]);
  });

  it("rejects an alias shared by two entries, naming both locations", () => {
    expect(() =>
      parseConfig(
        '[{"name":"bug","color":"#ff0000","aliases":["defect"]},{"name":"issue","color":"#00ff00","aliases":["defect"]}]',
        "json",
      ),
    ).toThrow(/labels\[1\].*duplicate alias.*labels\[0\]/u);
  });

  it("rejects an alias that matches a declared label name, ignoring case", () => {
    expect(() =>
      parseConfig(
        '[{"name":"bug","color":"#ff0000"},{"name":"issue","color":"#00ff00","aliases":["Bug"]}]',
        "json",
      ),
    ).toThrow(/labels\[1\].*alias "Bug".*labels\[0\]/u);
  });

  it("rejects an alias that matches the entry's own name", () => {
    expect(() =>
      parseConfig('[{"name":"bug","color":"#ff0000","aliases":["bug"]}]', "json"),
    ).toThrow(/alias "bug"/u);
  });
});

describe(loadConfigFile, () => {
  it("loads JSON and YAML files", () => {
    const dir = tempDir();
    const jsonPath = join(dir, "labels.json");
    const yamlPath = join(dir, "labels.yaml");
    writeFileSync(jsonPath, '[{"name":"bug","color":"#ff0000"}]');
    writeFileSync(yamlPath, '- name: docs\n  color: "#0075ca"\n');

    expect(loadConfigFile(jsonPath).labels[0]?.name).toBe("bug");
    expect(loadConfigFile(yamlPath).labels[0]?.name).toBe("docs");
  });

  it("fails with a hint when the file is missing", () => {
    expect(() => loadConfigFile("/nonexistent/labels.json")).toThrow(/not found/u);
  });
});

describe(findConventionConfig, () => {
  it("returns the highest-priority file when several exist", () => {
    const dir = tempDir();
    writeFileSync(join(dir, ".gh-labeler.yaml"), '- name: a\n  color: "#ff0000"\n');
    writeFileSync(join(dir, ".gh-labeler.json"), '[{"name":"b","color":"#ff0000"}]');

    expect(findConventionConfig(dir)).toBe(join(dir, ".gh-labeler.json"));
  });

  it("finds files under .github/", () => {
    const dir = tempDir();
    mkdirSync(join(dir, ".github"));
    writeFileSync(join(dir, ".github", "labels.yaml"), '- name: a\n  color: "#ff0000"\n');

    expect(findConventionConfig(dir)).toBe(join(dir, ".github", "labels.yaml"));
  });

  it("returns null when nothing matches", () => {
    expect(findConventionConfig(tempDir())).toBeNull();
  });
});

describe(parseRemoteConfigRef, () => {
  it("parses owner/repo", () => {
    expect(parseRemoteConfigRef("org/repo")).toStrictEqual({
      owner: "org",
      repo: "repo",
    });
  });

  it("parses owner/repo:path", () => {
    expect(parseRemoteConfigRef("org/repo:path/to/labels.json")).toStrictEqual({
      owner: "org",
      repo: "repo",
      path: "path/to/labels.json",
    });
  });

  it("rejects an empty path", () => {
    expect(() => parseRemoteConfigRef("org/repo:")).toThrow(ConfigError);
  });

  it("rejects invalid repositories", () => {
    expect(() => parseRemoteConfigRef("invalid:file.json")).toThrow(ConfigError);
    expect(() => parseRemoteConfigRef("no-slash")).toThrow(ConfigError);
  });
});

function fakeFetcher(files: Record<string, string>): RemoteFileFetcher {
  return {
    fetchFile: (_owner, _repo, path) => Promise.resolve(files[path] ?? null),
  };
}

describe(fetchRemoteConfig, () => {
  it("fetches an explicit path", async () => {
    const fetcher = fakeFetcher({
      "labels.json": '[{"name":"bug","color":"#ff0000"}]',
    });
    const config = await fetchRemoteConfig(fetcher, {
      owner: "o",
      repo: "r",
      path: "labels.json",
    });
    expect(config.labels[0]?.name).toBe("bug");
  });

  it("fails when the explicit path is missing", async () => {
    await expect(
      fetchRemoteConfig(fakeFetcher({}), {
        owner: "o",
        repo: "r",
        path: "labels.json",
      }),
    ).rejects.toThrow(/not found/u);
  });

  it("searches convention files in priority order", async () => {
    const fetcher = fakeFetcher({
      ".github/labels.yml": '- name: low\n  color: "#ff0000"\n',
      ".gh-labeler.json": '[{"name":"high","color":"#ff0000"}]',
    });
    const config = await fetchRemoteConfig(fetcher, { owner: "o", repo: "r" });
    expect(config.labels[0]?.name).toBe("high");
  });

  it("fails listing the searched files in the hint when none exist", async () => {
    const promise = fetchRemoteConfig(fakeFetcher({}), {
      owner: "o",
      repo: "r",
    });
    await expect(promise).rejects.toThrow(/No label config found/u);
    await expect(promise).rejects.toMatchObject({
      hint: expect.stringContaining(CONVENTION_CONFIG_FILES[0]),
    });
  });
});

describe(serializeConfigDocument, () => {
  const labels = [{ name: "bug", color: "#d73a4a", description: "A bug" }];

  it("emits YAML with an editor schema directive", () => {
    const doc = serializeConfigDocument(labels, "yaml");
    expect(doc).toContain(`# yaml-language-server: $schema=${CONFIG_SCHEMA_URL}`);
    expect(doc).toContain("labels:");
    expect(doc).toContain("name: bug");
  });

  it("emits JSON with $schema", () => {
    const doc = serializeConfigDocument(labels, "json");
    const parsed = JSON.parse(doc);
    expect(parsed.$schema).toBe(CONFIG_SCHEMA_URL);
    expect(parsed.labels).toHaveLength(1);
  });

  it("round-trips through parseConfig", () => {
    for (const format of ["yaml", "json"] as const) {
      const doc = serializeConfigDocument(labels, format);
      const parsed = parseConfig(doc, format);
      expect(parsed.labels).toStrictEqual(labels);
    }
  });

  it("omits empty optional fields", () => {
    const doc = serializeConfigDocument([{ name: "bug", color: "#d73a4a" }], "json");
    expect(doc).not.toContain("description");
    expect(doc).not.toContain("aliases");
    expect(doc).not.toContain("delete");
  });
});
