/**
 * The `test` script runs jest with NODE_OPTIONS=--experimental-vm-modules.
 * pdfjs-dist ships ESM only, and src/services/pdf-rasterize.ts reaches it via a
 * dynamic import; without that flag Jest's VM context has no dynamic-import
 * callback and the call fails with ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG.
 * This affects the test sandbox only — production runs plain Node, where the
 * import resolves normally.
 *
 * @type {import('jest').Config}
 */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: ".",
  testMatch: ["<rootDir>/tests/**/*.test.ts"],
  setupFiles: ["<rootDir>/tests/setup.ts"],
  coverageDirectory: "coverage",
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.d.ts"],
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: "./tsconfig.test.json" }],
  },
  // express-rate-limit's in-memory store leaves timers after suites finish.
  // forceExit so those don't keep the process hanging once assertions are done.
  forceExit: true,
};
