// Browser-compatibility lint only (Collective-Shared plans/2026-10-01-safari-quality.md, Layer 6): flags browser APIs
// the supported browsers lack — the "browserslist" in package.json (Safari/iOS 16.4+, the last two Chrome, Firefox and
// Edge). Not a style lint. Client code only; the esbuild bundles and vendored files are generated.
//   npm run lint:compat
import compatPlugin from "eslint-plugin-compat";
import globals from "globals";

export default [
  { ignores: ["**/*-bundle.js", "src/public/js/vendor/**", "mockups/**", "node_modules/**"] },
  {
    ...compatPlugin.configs["flat/recommended"],
    files: ["src/public/js/**/*.js", "src/reader-userdata/**/*.js", "src/*-entry.js"],
    languageOptions: { ecmaVersion: 2023, sourceType: "module", globals: { ...globals.browser } },
    linterOptions: { reportUnusedDisableDirectives: "off" },
  },
];
