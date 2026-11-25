import globals from 'globals';

const safetyRules = { 'no-undef': 'error', 'no-dupe-keys': 'error', 'no-unreachable': 'error', 'no-invalid-regexp': 'error' };
export default [
  { ignores: ['**/dist/**', '**/test-results/**', '**/playwright-report/**'] },
  { files: ['apps/api/**/*.js', '*.js', 'browser/**/*.js', 'apps/web/vite.config.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } }, rules: safetyRules },
  { files: ['apps/web/src/**/*.{js,jsx}'],
    languageOptions: { globals: globals.browser, parserOptions: { ecmaFeatures: { jsx: true } } }, rules: safetyRules }
];
