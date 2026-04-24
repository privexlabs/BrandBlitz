import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@brandblitz/storage": path.resolve(__dirname, "../../packages/storage/src"),
      "@brandblitz/stellar": path.resolve(__dirname, "../../packages/stellar/src"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      all: true,
      include: ["src/services/scoring.ts", "src/middleware/error.ts", "src/routes/upload.ts"],
      reporter: ["text", "lcov"],
      statements: 95,
      branches: 95,
      functions: 95,
      lines: 95,
    },
  },
});
