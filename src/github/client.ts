import { retry } from "@octokit/plugin-retry";
import { throttling } from "@octokit/plugin-throttling";
import { Octokit } from "@octokit/rest";
import { type RemoteFileFetcher } from "#config/index.js";
import { parseRepository } from "#github/context.js";
import { ApiError, AuthError, type GhLabelerError, RepositoryNotFoundError } from "#errors.js";
import { type LabelSpec, normalizeColor } from "#core/labels.js";

/** A label as it exists on GitHub. `color` is API-form: `rrggbb` without `#`. */
export interface GitHubLabel {
  name: string;
  color: string;
  description: string | null;
}

/** DI boundary for label CRUD; mocked in tests. */
export interface LabelService {
  listLabels: () => Promise<GitHubLabel[]>;
  createLabel: (label: LabelSpec) => Promise<void>;
  /** Atomic PATCH: updates color/description and renames when `label.name` differs. */
  updateLabel: (currentName: string, label: LabelSpec) => Promise<void>;
  deleteLabel: (name: string) => Promise<void>;
}

/** Retries transient failures and waits out GitHub rate-limit windows. */
const ResilientOctokit = Octokit.plugin(retry, throttling);

function statusOf(err: unknown): number | undefined {
  if (typeof err === "object" && err !== null && "status" in err) {
    const { status } = err as { status: unknown };
    return typeof status === "number" ? status : undefined;
  }
  return undefined;
}

/** Map a failed repository-access probe to a stable, coded error. */
export function mapRepoAccessError(error: unknown, repository: string): GhLabelerError {
  const status = statusOf(error);
  if (status === 404) {
    return new RepositoryNotFoundError(repository);
  }
  if (status === 401) {
    return new AuthError(
      "GitHub rejected the token (401 Unauthorized)",
      'Check GITHUB_TOKEN / GH_TOKEN, or refresh your login with "gh auth login".',
    );
  }
  if (status === 403) {
    return new AuthError(
      `GitHub denied access to ${repository} (403 Forbidden)`,
      "The token was accepted but lacks permission: check its scopes or repository access, and authorize SAML SSO if the organization enforces it.",
    );
  }
  return new ApiError(
    `Failed to access ${repository}: ${error instanceof Error ? error.message : error}`,
  );
}

export class GitHubClient implements LabelService, RemoteFileFetcher {
  readonly owner: string;
  readonly repo: string;
  private readonly octokit: Octokit;

  private constructor(token: string, owner: string, repo: string) {
    this.owner = owner;
    this.repo = repo;
    this.octokit = new ResilientOctokit({
      auth: token,
      userAgent: "gh-labeler",
      throttle: {
        onRateLimit: (retryAfter, _options, _octokit, retryCount) => {
          if (retryCount < 2) {
            console.error(`gh-labeler: GitHub rate limit hit; retrying in ${retryAfter}s`);
            return true;
          }
          return false;
        },
        onSecondaryRateLimit: (retryAfter, _options, _octokit, retryCount) => {
          if (retryCount < 2) {
            console.error(`gh-labeler: secondary rate limit hit; retrying in ${retryAfter}s`);
            return true;
          }
          return false;
        },
      },
    });
  }

  /**
   * Create a client and verify access with a single `GET /repos/{owner}/{repo}`.
   * Unlike a `/user` probe, this works with installation tokens (GitHub Actions).
   */
  static async connect(token: string, repository: string): Promise<GitHubClient> {
    const { owner, repo } = parseRepository(repository);
    const client = new GitHubClient(token, owner, repo);

    try {
      await client.octokit.rest.repos.get({ owner, repo });
    } catch (error) {
      throw mapRepoAccessError(error, repository);
    }

    return client;
  }

  async listLabels(): Promise<GitHubLabel[]> {
    const labels = await this.octokit.paginate(this.octokit.rest.issues.listLabelsForRepo, {
      owner: this.owner,
      repo: this.repo,
      per_page: 100,
    });
    return labels.map((label) => ({
      name: label.name,
      color: label.color,
      description: label.description ?? null,
    }));
  }

  async createLabel(label: LabelSpec): Promise<void> {
    await this.octokit.rest.issues.createLabel({
      owner: this.owner,
      repo: this.repo,
      name: label.name,
      color: normalizeColor(label.color),
      description: label.description ?? "",
    });
  }

  async updateLabel(currentName: string, label: LabelSpec): Promise<void> {
    await this.octokit.rest.issues.updateLabel({
      owner: this.owner,
      repo: this.repo,
      name: currentName,
      new_name: label.name,
      color: normalizeColor(label.color),
      description: label.description ?? "",
    });
  }

  async deleteLabel(name: string): Promise<void> {
    await this.octokit.rest.issues.deleteLabel({
      owner: this.owner,
      repo: this.repo,
      name,
    });
  }

  /** Contents API fetch used for remote configs; null when the file is absent. */
  async fetchFile(owner: string, repo: string, path: string): Promise<string | null> {
    try {
      const response = await this.octokit.rest.repos.getContent({
        owner,
        repo,
        path,
      });
      const { data } = response;
      if (Array.isArray(data) || !("content" in data)) {
        return null;
      }
      return Buffer.from(data.content, "base64").toString("utf8");
    } catch (error) {
      if (statusOf(error) === 404) {
        return null;
      }
      throw new ApiError(
        `Failed to fetch ${owner}/${repo}:${path}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}
