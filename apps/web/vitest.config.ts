import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineProject } from "vitest/config";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineProject({
  resolve: {
    alias: {
      "@": path.resolve(projectRoot, "./src"),
    },
  },
  test: {
    name: "@brandblitz/web",
    root: projectRoot,
    globals: true,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      reportsDirectory: "./coverage",
      thresholds: {
        branches: 0,
        functions: 0,
        lines: 0,
        statements: 0,
      },
    },
  },
});
