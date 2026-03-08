import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    ".wwebjs_auth/**",
    ".wwebjs_cache/**",
    "wa-bot/.wwebjs_auth/**",
    "wa-bot/.wwebjs_cache/**",
    "backend/**",
    "wa-bot/**",
  ]),
]);

export default eslintConfig;
