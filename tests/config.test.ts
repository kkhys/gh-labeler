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
  resolveConfigExtends,
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

  it("normalizes extends to an array", () => {
    expect(parseConfig('{"labels":[],"extends":"./base.yml"}', "json").extends).toStrictEqual([
      "./base.yml",
    ]);
    expect(
      parseConfig('{"labels":[],"extends":["./a.yml","org/repo"]}', "json").extends,
    ).toStrictEqual(["./a.yml", "org/repo"]);
  });

  it("rejects invalid extends values", () => {
    expect(() => parseConfig('{"labels":[],"extends":5}', "json")).toThrow(ConfigError);
    expect(() => parseConfig('{"labels":[],"extends":[""]}', "json")).toThrow(ConfigError);
    expect(() => parseConfig('{"labels":[],"extends":[42]}', "json")).toThrow(ConfigError);
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

function fakeRepoFetcher(repos: Record<string, Record<string, string>>): RemoteFileFetcher {
  return {
    fetchFile: (owner, repo, path) => Promise.resolve(repos[`${owner}/${repo}`]?.[path] ?? null),
  };
}

function writeConfig(dir: string, name: string, doc: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(doc));
  return path;
}

describe(resolveConfigExtends, () => {
  it("returns a config without extends unchanged", async () => {
    const config = parseConfig('[{"name":"bug","color":"#ff0000"}]', "json");
    await expect(resolveConfigExtends(config, null)).resolves.toBe(config);
  });

  it("merges base labels and overrides by name, case-insensitively", async () => {
    const dir = tempDir();
    writeConfig(dir, "base.json", {
      labels: [
        { name: "Bug", color: "#ff0000", description: "from base" },
        { name: "docs", color: "#0075ca" },
      ],
    });
    const childPath = writeConfig(dir, "child.json", {
      extends: "./base.json",
      labels: [
        { name: "bug", color: "#00ff00" },
        { name: "extra", color: "#000000" },
      ],
    });

    const resolved = await resolveConfigExtends(loadConfigFile(childPath), childPath);
    expect(resolved.labels).toStrictEqual([
      { name: "bug", color: "#00ff00" },
      { name: "docs", color: "#0075ca" },
      { name: "extra", color: "#000000" },
    ]);
  });

  it("lets the extending config cancel an inherited label with delete", async () => {
    const dir = tempDir();
    writeConfig(dir, "base.json", { labels: [{ name: "wontfix", color: "#ffffff" }] });
    const childPath = writeConfig(dir, "child.json", {
      extends: "./base.json",
      labels: [{ name: "wontfix", delete: true }],
    });

    const resolved = await resolveConfigExtends(loadConfigFile(childPath), childPath);
    expect(resolved.labels).toStrictEqual([{ name: "wontfix", delete: true }]);
  });

  it("does not inherit prune from a base config", async () => {
    const dir = tempDir();
    writeConfig(dir, "base.json", {
      labels: [{ name: "bug", color: "#ff0000" }],
      prune: true,
    });
    const childPath = writeConfig(dir, "child.json", { extends: "./base.json", labels: [] });

    const resolved = await resolveConfigExtends(loadConfigFile(childPath), childPath);
    expect(resolved.prune).toBeUndefined();
  });

  it("keeps the extending config's own prune", async () => {
    const dir = tempDir();
    writeConfig(dir, "base.json", {
      labels: [{ name: "bug", color: "#ff0000" }],
      prune: true,
    });
    const childPath = writeConfig(dir, "child.json", {
      extends: "./base.json",
      labels: [],
      prune: false,
    });

    const resolved = await resolveConfigExtends(loadConfigFile(childPath), childPath);
    expect(resolved.prune).toBe(false);
  });

  it("resolves nested extends depth-first", async () => {
    const dir = tempDir();
    writeConfig(dir, "c.json", { labels: [{ name: "from-c", color: "#111111" }] });
    writeConfig(dir, "b.json", {
      extends: "./c.json",
      labels: [{ name: "from-b", color: "#222222" }],
    });
    const aPath = writeConfig(dir, "a.json", {
      extends: "./b.json",
      labels: [{ name: "from-a", color: "#333333" }],
    });

    const resolved = await resolveConfigExtends(loadConfigFile(aPath), aPath);
    expect(resolved.labels.map((label) => label.name)).toStrictEqual([
      "from-c",
      "from-b",
      "from-a",
    ]);
  });

  it("merges multiple bases in order, later bases winning", async () => {
    const dir = tempDir();
    writeConfig(dir, "b1.json", {
      labels: [
        { name: "shared", color: "#111111" },
        { name: "only-b1", color: "#222222" },
      ],
    });
    writeConfig(dir, "b2.json", { labels: [{ name: "shared", color: "#333333" }] });
    const childPath = writeConfig(dir, "child.json", {
      extends: ["./b1.json", "./b2.json"],
      labels: [],
    });

    const resolved = await resolveConfigExtends(loadConfigFile(childPath), childPath);
    expect(resolved.labels).toStrictEqual([
      { name: "shared", color: "#333333" },
      { name: "only-b1", color: "#222222" },
    ]);
  });

  it("rejects circular extends", async () => {
    const dir = tempDir();
    writeConfig(dir, "a.json", { extends: "./b.json", labels: [] });
    const bPath = writeConfig(dir, "b.json", { extends: "./a.json", labels: [] });

    await expect(resolveConfigExtends(loadConfigFile(bPath), bPath)).rejects.toThrow(
      /Circular extends/u,
    );
  });

  it("fails when a local base file is missing", async () => {
    const dir = tempDir();
    const childPath = writeConfig(dir, "child.json", { extends: "./missing.json", labels: [] });

    await expect(resolveConfigExtends(loadConfigFile(childPath), childPath)).rejects.toThrow(
      /Extends target not found/u,
    );
  });

  it("rejects an extends reference that is neither a path nor owner/repo", async () => {
    const dir = tempDir();
    const childPath = writeConfig(dir, "child.json", { extends: "base.json", labels: [] });

    await expect(resolveConfigExtends(loadConfigFile(childPath), childPath)).rejects.toThrow(
      /Invalid extends reference/u,
    );
  });

  it("fails on remote extends without a fetcher", async () => {
    const dir = tempDir();
    const childPath = writeConfig(dir, "child.json", { extends: "org/labels", labels: [] });

    await expect(resolveConfigExtends(loadConfigFile(childPath), childPath)).rejects.toThrow(
      /without GitHub access/u,
    );
  });

  it("resolves remote extends through a fetcher", async () => {
    const dir = tempDir();
    const childPath = writeConfig(dir, "child.json", {
      extends: "org/labels",
      labels: [{ name: "local", color: "#111111" }],
    });
    const fetcher = fakeRepoFetcher({
      "org/labels": {
        ".gh-labeler.json": JSON.stringify({ labels: [{ name: "shared", color: "#222222" }] }),
      },
    });

    const resolved = await resolveConfigExtends(loadConfigFile(childPath), childPath, fetcher);
    expect(resolved.labels.map((label) => label.name)).toStrictEqual(["shared", "local"]);
  });

  it("rejects cross-file alias contradictions after merging", async () => {
    const dir = tempDir();
    writeConfig(dir, "base.json", {
      labels: [{ name: "bug", color: "#ff0000", aliases: ["defect"] }],
    });
    const childPath = writeConfig(dir, "child.json", {
      extends: "./base.json",
      labels: [{ name: "defect", color: "#00ff00" }],
    });

    await expect(resolveConfigExtends(loadConfigFile(childPath), childPath)).rejects.toThrow(
      /alias "defect"/u,
    );
  });
});

describe("fetchRemoteConfig with extends", () => {
  it("resolves extends inside the same repository, relative to the config file", async () => {
    const fetcher = fakeRepoFetcher({
      "o/r": {
        "configs/labels.json": JSON.stringify({
          extends: "./base.json",
          labels: [{ name: "child", color: "#111111" }],
        }),
        "configs/base.json": JSON.stringify({ labels: [{ name: "base", color: "#222222" }] }),
      },
    });

    const config = await fetchRemoteConfig(fetcher, {
      owner: "o",
      repo: "r",
      path: "configs/labels.json",
    });
    expect(config.labels.map((label) => label.name)).toStrictEqual(["base", "child"]);
  });

  it("resolves extends from a convention file at the repository root", async () => {
    const fetcher = fakeRepoFetcher({
      "o/r": {
        ".gh-labeler.json": JSON.stringify({
          extends: "./base.json",
          labels: [{ name: "child", color: "#111111" }],
        }),
        "base.json": JSON.stringify({ labels: [{ name: "base", color: "#222222" }] }),
      },
    });

    const config = await fetchRemoteConfig(fetcher, { owner: "o", repo: "r" });
    expect(config.labels.map((label) => label.name)).toStrictEqual(["base", "child"]);
  });

  it("rejects an extends path that escapes the repository", async () => {
    const fetcher = fakeRepoFetcher({
      "o/r": {
        "configs/labels.json": JSON.stringify({ extends: "../../evil.json", labels: [] }),
      },
    });

    await expect(
      fetchRemoteConfig(fetcher, { owner: "o", repo: "r", path: "configs/labels.json" }),
    ).rejects.toThrow(/escapes the repository/u);
  });

  it("follows extends into another repository", async () => {
    const fetcher = fakeRepoFetcher({
      "o/r": {
        ".gh-labeler.json": JSON.stringify({
          extends: "org/shared:labels.json",
          labels: [{ name: "local", color: "#111111" }],
        }),
      },
      "org/shared": {
        "labels.json": JSON.stringify({ labels: [{ name: "shared", color: "#222222" }] }),
      },
    });

    const config = await fetchRemoteConfig(fetcher, { owner: "o", repo: "r" });
    expect(config.labels.map((label) => label.name)).toStrictEqual(["shared", "local"]);
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
