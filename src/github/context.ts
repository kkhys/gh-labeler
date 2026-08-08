import { spawnSync } from "node:child_process";
import { AuthError, ConfigError } from "#errors.js";

export interface RepositoryRef {
  owner: string;
  repo: string;
}

export function parseRepository(input: string): RepositoryRef {
  const parts = input.split("/");
  const [owner, repo] = parts;
  if (parts.length !== 2 || !owner || !repo) {
    throw new ConfigError(
      `Invalid repository format: "${input}"`,
      'Expected "owner/repo", e.g. "kkhys/gh-labeler".',
    );
  }
  return { owner, repo };
}

/** Extract owner/repo from an https, ssh, or scp-style git remote URL. */
export function parseGitRemoteUrl(url: string): RepositoryRef | null {
  let path: string | undefined;

  if (/^[a-z+]+:\/\//iu.test(url)) {
    try {
      path = new URL(url).pathname;
    } catch {
      return null;
    }
  } else {
    // Scp-like syntax: git@github.com:owner/repo.git
    const match = url.match(/^(?:[^@/]+@)?[^:/]+:(?<rest>.+)$/u);
    path = match?.groups?.["rest"];
  }

  if (!path) {
    return null;
  }

  const segments = path
    .replace(/\.git$/u, "")
    .split("/")
    .filter(Boolean);
  const repo = segments.at(-1);
  const owner = segments.at(-2);
  if (!owner || !repo) {
    return null;
  }
  return { owner, repo };
}

/**
 * Resolve the target repository with zero-config fallbacks:
 * explicit argument → GITHUB_REPOSITORY (GitHub Actions) → `origin` remote.
 */
export function resolveRepository(explicit?: string, cwd: string = process.cwd()): string {
  if (explicit) {
    const { owner, repo } = parseRepository(explicit);
    return `${owner}/${repo}`;
  }

  const fromEnv = process.env["GITHUB_REPOSITORY"];
  if (fromEnv) {
    const { owner, repo } = parseRepository(fromEnv);
    return `${owner}/${repo}`;
  }

  const result = spawnSync("git", ["remote", "get-url", "origin"], {
    cwd,
    encoding: "utf8",
    timeout: 5000,
  });
  if (result.status === 0) {
    const parsed = parseGitRemoteUrl(result.stdout.trim());
    if (parsed) {
      return `${parsed.owner}/${parsed.repo}`;
    }
  }

  throw new ConfigError(
    "Could not determine the target repository",
    'Pass it explicitly (e.g. "gh-labeler sync owner/repo") or run inside a git clone with an "origin" remote.',
  );
}

/**
 * Resolve a GitHub token with zero-config fallbacks:
 * explicit flag → GITHUB_TOKEN → GH_TOKEN → `gh auth token` (GitHub CLI).
 */
export function resolveToken(explicit?: string): string {
  const token = explicit || process.env["GITHUB_TOKEN"] || process.env["GH_TOKEN"] || ghAuthToken();
  if (!token) {
    throw new AuthError(
      "No GitHub token found",
      'Set GITHUB_TOKEN (or GH_TOKEN), pass --token, or log in with the GitHub CLI ("gh auth login").',
    );
  }
  return token;
}

function ghAuthToken(): string | null {
  const result = spawnSync("gh", ["auth", "token"], {
    encoding: "utf8",
    timeout: 5000,
  });
  if (result.status === 0) {
    const token = result.stdout.trim();
    if (token) {
      return token;
    }
  }
  return null;
}
