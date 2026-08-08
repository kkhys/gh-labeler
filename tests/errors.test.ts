import { describe, expect, it } from "vitest";
import {
  ApiError,
  AuthError,
  ConfigError,
  EXIT_CODES,
  GeneralError,
  GhLabelerError,
  RepositoryNotFoundError,
  toGhLabelerError,
} from "#errors.js";

describe("exit code table", () => {
  it("are all distinct", () => {
    const codes = Object.values(EXIT_CODES);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe("error classes", () => {
  it("map to their exit codes", () => {
    expect(new ConfigError("x").exitCode).toBe(EXIT_CODES.CONFIG_ERROR);
    expect(new AuthError("x").exitCode).toBe(EXIT_CODES.AUTH_ERROR);
    expect(new RepositoryNotFoundError("o/r").exitCode).toBe(EXIT_CODES.REPO_NOT_FOUND);
    expect(new ApiError("x").exitCode).toBe(EXIT_CODES.GENERAL_ERROR);
    expect(new GeneralError("x").exitCode).toBe(EXIT_CODES.GENERAL_ERROR);
  });

  it("carry stable machine-readable codes", () => {
    expect(new ConfigError("x").code).toBe("config_error");
    expect(new AuthError("x").code).toBe("auth_error");
    expect(new RepositoryNotFoundError("o/r").code).toBe("repository_not_found");
    expect(new ApiError("x").code).toBe("github_api_error");
    expect(new GeneralError("x").code).toBe("general_error");
  });

  it("include the repository in not-found messages", () => {
    expect(new RepositoryNotFoundError("o/r").message).toContain("o/r");
  });

  it("carry optional hints", () => {
    expect(new ConfigError("x", "do y").hint).toBe("do y");
    expect(new ConfigError("x").hint).toBeUndefined();
  });
});

describe(toGhLabelerError, () => {
  it("passes GhLabelerError through unchanged", () => {
    const original = new ConfigError("x");
    expect(toGhLabelerError(original)).toBe(original);
  });

  it("wraps plain errors with the general_error code", () => {
    const wrapped = toGhLabelerError(new Error("boom"));
    expect(wrapped).toBeInstanceOf(GhLabelerError);
    expect(wrapped.code).toBe("general_error");
    expect(wrapped.exitCode).toBe(EXIT_CODES.GENERAL_ERROR);
    expect(wrapped.message).toBe("boom");
  });

  it("wraps errors carrying an HTTP status as ApiError", () => {
    const wrapped = toGhLabelerError(Object.assign(new Error("boom"), { status: 500 }));
    expect(wrapped.code).toBe("github_api_error");
    expect(wrapped.exitCode).toBe(EXIT_CODES.GENERAL_ERROR);
  });

  it("wraps non-error values", () => {
    const wrapped = toGhLabelerError("boom");
    expect(wrapped.message).toBe("boom");
    expect(wrapped.code).toBe("general_error");
  });
});
