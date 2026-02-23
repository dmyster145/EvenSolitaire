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
  },
});
