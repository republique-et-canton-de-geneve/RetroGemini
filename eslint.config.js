import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import jsxA11yPlugin from 'eslint-plugin-jsx-a11y';
import reactRefreshPlugin from 'eslint-plugin-react-refresh';
import globals from 'globals';

export default [
  {
    ignores: [
      'dist/**',
      'build/**',
      'node_modules/**',
      'coverage/**',
      '*.config.js',
      'vite.config.ts',
    ],
  },
  {
    files: ['**/*.{js,mjs,cjs,jsx,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooksPlugin,
      'react-refresh': reactRefreshPlugin,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tsPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,

      // TypeScript specific rules
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-non-null-assertion': 'warn',

      // React specific rules
      // Disable React Compiler rules introduced in eslint-plugin-react-hooks v7
      // (set-state-in-effect, immutability, refs, globals) — these are experimental
      // compiler rules not applicable to this codebase
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/globals': 'off',
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],

      // General code quality rules
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      'no-debugger': 'warn',
      'no-alert': 'warn',
      'prefer-const': 'error',
      'no-var': 'error',

      // Security rules
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
    },
  },
  {
    // Node.js server files and load-test tooling. Backend code lives under
    // `server/**` (the root `services/` directory holds only frontend `.ts`),
    // so the override must target `server/**/*.js` — the previous
    // `services/**/*.js` glob matched nothing, leaving every backend file to
    // warn on legitimate `console` logging and burying the real warnings.
    // `scripts/**` holds developer CLI tooling (the lint ratchet), whose entire
    // output *is* console writes — budgeting those would spend the warning
    // budget on the tool that guards it.
    files: ['server.js', 'server/**/*.js', 'loadtest/**/*.js', 'scripts/**/*.{js,mjs}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-console': 'off', // Allow console in server code
    },
  },
  {
    // Accessibility (audit H42). For a Geneva public-sector deployment this is a
    // conformance obligation (eCH-0059 / WCAG 2.1 AA), not a polish item, and
    // 15 000 lines of React had never been checked by anything.
    //
    // `warn`, folded into the two-way budget in `scripts/lint.mjs`, rather than
    // `error`: the plugin reports ~170 findings on first run, and a gate that
    // fails the build on day one is a gate someone disables by the end of the
    // week. The ratchet makes the number monotonically decreasing instead, which
    // is the property that matters.
    //
    // **What this cannot see**, and the reason it is only step (3) of H42: a
    // lint rule inspects the markup that exists. It cannot report an operation
    // that has *no* keyboard path at all — the Group-phase drag is a perfectly
    // well-formed `div` that simply cannot be reached without a pointer, and no
    // rule fires on it. Automated tooling cannot see an absent control; that is
    // what the manual keyboard pass recorded in HARDENING_STATUS.md is for.
    files: ['**/*.{jsx,tsx}'],
    ignores: ['__tests__/**', 'e2e/**', 'e2e-prod/**', '**/*.{test,spec}.{jsx,tsx}'],
    plugins: {
      'jsx-a11y': jsxA11yPlugin,
    },
    rules: Object.fromEntries(
      Object.entries(jsxA11yPlugin.flatConfigs.recommended.rules).map(([rule, setting]) => {
        // Keep the recommended set's own opinion about *which* rules are on and
        // with what options; only the severity is rewritten. Re-enabling what
        // recommended turns off would revive `label-has-for`, a deprecated rule
        // that duplicates `label-has-associated-control` and would inflate the
        // baseline by 43 findings that nobody should act on.
        const severity = Array.isArray(setting) ? setting[0] : setting;
        const options = Array.isArray(setting) ? setting.slice(1) : [];
        const isOff = severity === 'off' || severity === 0;
        return [rule, isOff ? 'off' : ['warn', ...options]];
      }),
    ),
  },
  {
    // Test files: non-null assertions, `any` and direct `console` use are
    // idiomatic in test setup, mocks and assertions (a test may spy on, capture
    // or restore console methods). Keeping them as warnings only buried the real
    // warnings from source files behind test-only entries, so they are relaxed
    // here. Source files keep the strict rules.
    files: ['__tests__/**/*.{ts,tsx}', '**/*.{test,spec}.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
];
