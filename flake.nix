{
  description = "Development environment for gh-labeler";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  };

  outputs =
    { nixpkgs, ... }:
    let
      systems = [
        "aarch64-darwin"
        "x86_64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ];
      forEachSystem = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      devShells = forEachSystem (pkgs: {
        default = pkgs.mkShell {
          packages = [
            pkgs.nodejs_26
            # corepack provisions the exact pnpm pinned in package.json's packageManager.
            # Node.js 25+ no longer bundles corepack (no corepack_26), so the standalone
            # package is rebuilt on Node 26 to keep pnpm and scripts on one runtime.
            (pkgs.corepack.override { nodejs-slim = pkgs.nodejs-slim_26; })
            pkgs.gh
          ];
        };
      });
    };
}
