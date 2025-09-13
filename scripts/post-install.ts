#!/usr/bin/env node

/**
 * Post-install script for gh-labeler npm package
 *
 * This script ensures the Rust binary is available and executable after npm install.
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const binPath = path.join(__dirname, "..", "bin", "gh-labeler");
const targetPath = path.join(
  __dirname,
  "..",
  "target",
  "release",
  "gh-labeler",
);

/**
 * Check if Rust binary exists and copy it to bin directory
 */
function setupBinary() {
  try {
    // Check if target binary exists
    if (fs.existsSync(targetPath)) {
      console.log("✓ Found Rust binary in target/release/");

      // Create bin directory if it doesn't exist
      const binDir = path.dirname(binPath);
      if (!fs.existsSync(binDir)) {
        fs.mkdirSync(binDir, { recursive: true });
      }

      // Copy binary to bin directory
      fs.copyFileSync(targetPath, binPath);

      // Make binary executable (Unix/Linux/macOS)
      if (process.platform !== "win32") {
        fs.chmodSync(binPath, "755");
      }

      console.log("✓ gh-labeler binary installed successfully");
    } else {
      console.warn("⚠ Rust binary not found. Run `npm run build` to compile.");
      process.exit(0); // Don't fail installation
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("✗ Failed to setup gh-labeler binary:", errorMessage);
    console.log("You may need to run `npm run build` manually.");
    process.exit(0); // Don't fail installation
  }
}

/**
 * Verify the binary works
 */
function verifyBinary() {
  try {
    if (fs.existsSync(binPath)) {
      const output = execSync(`"${binPath}" --version`, {
        encoding: "utf8",
        timeout: 5000,
      });
      console.log("✓ Binary verification successful:", output.trim());
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn("⚠ Binary verification failed:", errorMessage);
    console.log("The binary may still work, but verification failed.");
  }
}

/**
 * Display installation success message
 */
function displaySuccessMessage() {
  console.log("");
  console.log("🎉 gh-labeler installed successfully!");
  console.log("");
  console.log("Usage:");
  console.log("  gh-labeler sync -t YOUR_GITHUB_TOKEN -r owner/repo");
  console.log("  gh-labeler --help");
  console.log("");
  console.log(
    "For more information, visit: https://github.com/kkhys/gh-labeler",
  );
  console.log("");
}

// Main installation process
console.log("Installing gh-labeler...");
setupBinary();
verifyBinary();
displaySuccessMessage();
