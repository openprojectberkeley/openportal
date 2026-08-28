import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Unit tests are pure Node (no DOM needed). The `@/` alias mirrors the paths
// mapping in tsconfig.json so test imports match app imports. TZ is pinned so
// any locale/day-grouping assertions are deterministic across machines and CI.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: { TZ: "UTC" },
  },
});
