import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        // An explicit IPv4 loopback avoids Node's dual-stack localhost lookup
        // reporting an AggregateError while the API is briefly restarting.
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    // Production source maps expose implementation details and substantially
    // increase deploy size. Enable them only in a dedicated error-reporting
    // upload workflow rather than publishing them with the application.
    sourcemap: false,
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // Keep coverage-heavy jsdom suites from starving individual tests on
    // high-core Windows and CI hosts.
    maxWorkers: 4,
    // Coverage instrumentation and parallel jsdom suites can push interaction
    // tests past Vitest's 5-second default on Windows CI runners.
    testTimeout: 10_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
    },
  },
});
