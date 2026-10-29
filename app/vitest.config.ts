import { defineConfig } from "vitest/config";

// Unit tests for app/lib only; keeps the React Router Vite plugin out of test runs.
export default defineConfig({
  test: { include: ["app/**/*.test.ts"], environment: "node" },
});
