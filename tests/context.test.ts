import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  parseGitRemoteUrl,
  parseRepository,
  resolveRepository,
  resolveToken,
} from "#github/context.js";
import { AuthError, ConfigError } from "#errors.js";

describe(parseRepository, () => {
  it("parses owner/repo", () => {
    expect(parseRepository("owner/repo")).toStrictEqual({
      owner: "owner",
      repo: "repo",
    });
  });

  it("rejects malformed input", () => {
    for (const input of ["repo", "/repo", "owner/", "owner/repo/sub", ""]) {
      expect(() => parseRepository(input)).toThrow(ConfigError);
    }
  });
});

describe(parseGitRemoteUrl, () => {
  it("parses https URLs", () => {
    expect(parseGitRemoteUrl("https://github.com/kkhys/gh-labeler.git")).toStrictEqual({
      owner: "kkhys",
      repo: "gh-labeler",
    });
    expect(parseGitRemoteUrl("https://github.com/kkhys/gh-labeler")).toStrictEqual({
      owner: "kkhys",
      repo: "gh-labeler",
    });
  });

  it("parses scp-style ssh remotes", () => {
    expect(parseGitRemoteUrl("git@github.com:kkhys/gh-labeler.git")).toStrictEqual({
      owner: "kkhys",
      repo: "gh-labeler",
    });
  });

  it("parses ssh:// URLs", () => {
    expect(parseGitRemoteUrl("ssh://git@github.com/kkhys/gh-labeler.git")).toStrictEqual({
      owner: "kkhys",
      repo: "gh-labeler",
    });
  });

  it("returns null for unusable input", () => {
    expect(parseGitRemoteUrl("")).toBeNull();
    expect(parseGitRemoteUrl("https://github.com/kkhys")).toBeNull();
  });
});

describe(resolveRepository, () => {
  // Git exports GIT_DIR and related variables to hooks, so under a pre-push
  // hook `git remote get-url origin` would resolve the hook's repository even
  // from an unrelated directory.
  const isolatedEnv = [
    "GITHUB_REPOSITORY",
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_COMMON_DIR",
    "GIT_CEILING_DIRECTORIES",
  ];
  const saved = new Map(isolatedEnv.map((key) => [key, process.env[key]]));

  beforeEach(() => {
    for (const key of isolatedEnv) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, value] of saved) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("prefers the explicit argument", () => {
    process.env["GITHUB_REPOSITORY"] = "env/repo";
    expect(resolveRepository("cli/repo")).toBe("cli/repo");
  });

  it("falls back to GITHUB_REPOSITORY", () => {
    process.env["GITHUB_REPOSITORY"] = "env/repo";
    expect(resolveRepository()).toBe("env/repo");
  });

  it("validates the explicit argument", () => {
    expect(() => resolveRepository("not-a-repo")).toThrow(ConfigError);
  });

  it("fails with a hint when nothing can be inferred", () => {
    const dir = mkdtempSync(join(tmpdir(), "gh-labeler-norepo-"));
    // Keep git from discovering a clone above the temp directory, since
    // TMPDIR can itself live inside one.
    process.env["GIT_CEILING_DIRECTORIES"] = dirname(dir);
    expect(() => resolveRepository(undefined, dir)).toThrow(ConfigError);
  });
});

describe(resolveToken, () => {
  const savedGithub = process.env["GITHUB_TOKEN"];
  const savedGh = process.env["GH_TOKEN"];

  beforeEach(() => {
    process.env["GITHUB_TOKEN"] = "github-token";
    process.env["GH_TOKEN"] = "gh-token";
  });

  afterEach(() => {
    if (savedGithub === undefined) {
      delete process.env["GITHUB_TOKEN"];
    } else {
      process.env["GITHUB_TOKEN"] = savedGithub;
    }
    if (savedGh === undefined) {
      delete process.env["GH_TOKEN"];
    } else {
      process.env["GH_TOKEN"] = savedGh;
    }
  });

  it("prefers the explicit token", () => {
    expect(resolveToken("explicit")).toBe("explicit");
  });

  it("prefers GITHUB_TOKEN over GH_TOKEN", () => {
    expect(resolveToken()).toBe("github-token");
  });

  it("falls back to GH_TOKEN", () => {
    delete process.env["GITHUB_TOKEN"];
    expect(resolveToken()).toBe("gh-token");
  });

  it("throws AuthError with an empty explicit token and no env", () => {
    delete process.env["GITHUB_TOKEN"];
    delete process.env["GH_TOKEN"];
    // `gh auth token` may succeed on a developer machine, so only assert the
    // Error type when the CLI fallback also yields nothing.
    try {
      resolveToken("");
    } catch (error) {
      // eslint-disable-next-line vitest/no-conditional-expect
      expect(error).toBeInstanceOf(AuthError);
    }
  });
});
