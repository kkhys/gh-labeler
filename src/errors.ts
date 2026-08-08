export const EXIT_CODES = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,
  CONFIG_ERROR: 2,
  AUTH_ERROR: 3,
  REPO_NOT_FOUND: 4,
  PARTIAL_FAILURE: 5,
  /** Only from `plan --check`: the plan succeeded but changes are pending. */
  DRIFT: 6,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

/**
 * Base error for all gh-labeler failures. Carries a stable machine-readable
 * `code` (surfaced in JSON output), a process exit code, and an optional
 * human-actionable `hint`.
 */
export class GhLabelerError extends Error {
  readonly code: string;
  readonly exitCode: ExitCode;
  readonly hint?: string;

  constructor(code: string, exitCode: ExitCode, message: string, hint?: string) {
    super(message);
    this.name = "GhLabelerError";
    this.code = code;
    this.exitCode = exitCode;
    if (hint !== undefined) {
      this.hint = hint;
    }
  }
}

export class ConfigError extends GhLabelerError {
  constructor(message: string, hint?: string) {
    super("config_error", EXIT_CODES.CONFIG_ERROR, message, hint);
    this.name = "ConfigError";
  }
}

export class AuthError extends GhLabelerError {
  constructor(message: string, hint?: string) {
    super("auth_error", EXIT_CODES.AUTH_ERROR, message, hint);
    this.name = "AuthError";
  }
}

export class RepositoryNotFoundError extends GhLabelerError {
  constructor(repository: string, hint?: string) {
    super(
      "repository_not_found",
      EXIT_CODES.REPO_NOT_FOUND,
      `Repository not found: ${repository}`,
      hint ?? "Check the repository name and that your token can access it.",
    );
    this.name = "RepositoryNotFoundError";
  }
}

export class ApiError extends GhLabelerError {
  constructor(message: string, hint?: string) {
    super("github_api_error", EXIT_CODES.GENERAL_ERROR, message, hint);
    this.name = "ApiError";
  }
}

/** Unexpected non-API failure (fs, spawn, bugs); same exit code as ApiError. */
export class GeneralError extends GhLabelerError {
  constructor(message: string, hint?: string) {
    super("general_error", EXIT_CODES.GENERAL_ERROR, message, hint);
    this.name = "GeneralError";
  }
}

function hasHttpStatus(err: Error): boolean {
  return "status" in err && typeof (err as { status: unknown }).status === "number";
}

/** Normalize any thrown value into a GhLabelerError without losing context. */
export function toGhLabelerError(err: unknown): GhLabelerError {
  if (err instanceof GhLabelerError) {
    return err;
  }
  if (err instanceof Error) {
    // Octokit request errors carry a numeric HTTP status; anything else is
    // not a GitHub API failure and must not be labeled as one.
    return hasHttpStatus(err) ? new ApiError(err.message) : new GeneralError(err.message);
  }
  return new GeneralError(String(err));
}
