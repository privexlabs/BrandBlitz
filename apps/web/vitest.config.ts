import path from "path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      all: true,
      include: ["src/components/game/result-screen.tsx"],
      reporter: ["text", "lcov"],
      statements: 85,
      branches: 85,
      functions: 85,
      lines: 85,
    },
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
