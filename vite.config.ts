import { defineConfig } from "vite";
import { readFileSync } from "fs";

const appJson = JSON.parse(readFileSync("./app.json", "utf-8")) as { version: string };

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appJson.version),
  },
  root: ".",
  server: {
    host: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: { main: "index.html" },
    },
  },
  resolve: {
    alias: {},
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.d.ts",
        "src/**/*.test.ts",
        "src/main.ts",
        "src/evenhub/**",
        "src/perf/**",
        "src/state/actions.ts",
        "src/state/types.ts",
        "src/app/lifecycle.ts",
      ],
      reporter: ["text", "json-summary", "html"],
      thresholds: {
        lines: 51,
        functions: 78,
        statements: 51,
        branches: 60,
      },
    },
  },
});
