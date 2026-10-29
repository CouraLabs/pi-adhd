import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    // Default to node env so server tests (which use real fetch against
    // ephemeral HTTP servers) keep working. Client tests opt into happy-dom
    // via the `// @vitest-environment happy-dom` pragma at the top of each file.
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
});
