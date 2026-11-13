import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default tseslint.config(
  { ignores: ["dist", "dist-electron", "node_modules"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/renderer/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      // eslint-plugin-react-hooks 7 added React Compiler rules to "recommended". The app does not use the compiler,
      // so keep the classic hook rules and leave the compiler-only checks off until a refactor adopts them.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
  {
    // The SDK is the seam a future standalone package is cut along: contracts and pure builders only.
    files: ["src/sdk/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{
        group: ["**/renderer/**", "**/main/**", "**/preload/**", "electron", "zustand", "zod", "react-aria-components"],
        message: "src/sdk may import only react types and pure modules from src/shared. Implementations belong to the host.",
      }] }],
    },
  },
  {
    files: ["src/main/**/*.ts", "src/preload/**/*.ts"],
    languageOptions: { globals: { __dirname: "readonly", process: "readonly" } },
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        document: "readonly",
        innerHeight: "readonly",
        innerWidth: "readonly",
        process: "readonly",
      },
    },
  },
);
