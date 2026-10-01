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
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Immutable design reference contains original, vendored preview libraries.
    "docs/onboarding/approved/**",
    "docs/foundation/approved/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
