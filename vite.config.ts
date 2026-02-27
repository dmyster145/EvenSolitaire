import { defineConfig } from "vite";

export default defineConfig({
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
