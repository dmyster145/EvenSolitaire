import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const coverageRequired = process.env.COVERAGE_REQUIRED === "1";

function hasCoverageProvider() {
  try {
    require.resolve("@vitest/coverage-v8/package.json");
    return true;
  } catch {
    return false;
  }
}

if (!hasCoverageProvider()) {
  const message =
    "[coverage] @vitest/coverage-v8 is not installed. Skipping coverage locally.";
  if (coverageRequired) {
    console.error(
      `${message} Set up the provider first because COVERAGE_REQUIRED=1.`,
    );
    process.exit(1);
  }
  console.log(message);
  process.exit(0);
}

const vitestCommand = process.platform === "win32" ? "vitest.cmd" : "vitest";
const result = spawnSync(vitestCommand, ["run", "--coverage"], {
  stdio: "inherit",
});

if (result.error) {
  console.error("[coverage] Failed to execute vitest:", result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
