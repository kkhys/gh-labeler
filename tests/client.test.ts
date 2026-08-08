import { describe, expect, it } from "vitest";
import { ApiError, AuthError, RepositoryNotFoundError } from "#errors.js";
import { mapRepoAccessError } from "#github/client.js";

function httpError(status: number): Error {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

describe(mapRepoAccessError, () => {
  it("maps 404 to RepositoryNotFoundError (exit 4)", () => {
    const error = mapRepoAccessError(httpError(404), "octo/repo");
    expect(error).toBeInstanceOf(RepositoryNotFoundError);
    expect(error).toMatchObject({ code: "repository_not_found", exitCode: 4 });
  });

  it("maps 401 to AuthError (exit 3)", () => {
    const error = mapRepoAccessError(httpError(401), "octo/repo");
    expect(error).toBeInstanceOf(AuthError);
    expect(error).toMatchObject({ code: "auth_error", exitCode: 3 });
  });

  it("maps 403 to AuthError so agents can tell permission problems apart", () => {
    const error = mapRepoAccessError(httpError(403), "octo/repo");
    expect(error).toBeInstanceOf(AuthError);
    expect(error).toMatchObject({ code: "auth_error", exitCode: 3 });
    expect(error.hint).toMatch(/SAML/u);
  });

  it("maps other HTTP failures to ApiError", () => {
    expect(mapRepoAccessError(httpError(500), "octo/repo")).toBeInstanceOf(ApiError);
  });

  it("maps non-HTTP failures to ApiError with the original message", () => {
    const error = mapRepoAccessError(new Error("socket hang up"), "octo/repo");
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toContain("socket hang up");
  });
});
