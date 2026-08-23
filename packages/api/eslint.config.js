// @ts-check
const js = require("@eslint/js");
const tseslint = require("typescript-eslint");
const globals = require("globals");

module.exports = tseslint.config(
  {
    ignores: ["dist/**", "coverage/**", "node_modules/**", "prisma/migrations/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { ecmaVersion: 2022, sourceType: "module" },
    },
    rules: {
      // Unused args are common in Express middleware signatures (req, res, next)
      // where position matters; allow the leading-underscore convention the
      // codebase already uses.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "none",
          // `const { secret, ...rest } = row` is how this codebase strips a
          // field before returning a row. The binding is meant to be unused.
          ignoreRestSiblings: true,
        },
      ],
      // Prisma's generated types and the Express request augmentation both make
      // narrow `any` use hard to avoid; flag it without failing the build.
      "@typescript-eslint/no-explicit-any": "warn",
      // `declare global { namespace Express }` is the supported way to augment
      // Express's Request; module augmentation is not an alternative here.
      "@typescript-eslint/no-namespace": ["error", { allowDeclarations: true }],
      // The SSE handlers (notification.controller, ai.controller) build a
      // teardown closure that must reference `writer`/`heartbeat` before either
      // is assigned — `close()` clears the interval and closes the writer, and
      // the writer's own onOverflow callback calls `close()`. That mutual
      // reference forces a `let` declaration, and ai.controller's heartbeat is
      // additionally assigned only on the path that survives its early returns,
      // so it can never be `const`. Reporting these is what the rule's
      // ignoreReadBeforeAssign option exists to prevent; the rule still catches
      // every ordinary never-reassigned `let`.
      "prefer-const": ["error", { ignoreReadBeforeAssign: true }],
    },
  },
  {
    // Flat config and jest.config are CommonJS by design.
    files: ["**/*.js"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    files: ["tests/**/*.ts"],
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
    },
    rules: {
      // Test doubles legitimately cast through any/non-null to build partial
      // fixtures for Prisma's deeply-typed models, and mock helpers are typed
      // as bare `Function` because they stand in for many signatures.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-function-type": "off",
      "@typescript-eslint/no-require-imports": "off",
    },
  },
);
