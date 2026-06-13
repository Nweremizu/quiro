import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@electron": path.resolve(__dirname, "electron"),
    },
  },
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.{test,spec}.{ts,tsx}", "electron/**/*.{test,spec}.ts"],
    exclude: [
      "**/node_modules/**",
      "**/.tmp/**",
      "**/dist/**",
      "**/dist-electron/**",
      "**/release/**",
      "**/electron/native/**",
      "**/public/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "coverage",
      exclude: [
        "**/*.test.{ts,tsx}",
        "**/*.spec.{ts,tsx}",
        "**/*.d.ts",
        "**/.tmp/**",
        "**/dist/**",
        "**/dist-electron/**",
        "**/electron/native/**",
      ],
    },
  },
});
