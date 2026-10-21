import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  { files: ['checkUtility.js', 'uploadData.js'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-stage-test/**",
    ".next-stage-test-*/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Immutable design reference contains original, vendored preview libraries.
    "docs/onboarding/approved/**",
    "docs/foundation/approved/**",
    "playwright-report/**",
    "test-results/**",
    // Agent worktrees under .claude/worktrees/ are full checkouts of this same
    // repository, so without this every file is linted twice and a concurrent
    // agent's in-progress work is reported as errors in this one's gate.
    ".claude/**",
    "test-results-*/**",
  ]),
]);

export default eslintConfig;
