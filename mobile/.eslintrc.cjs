/**
 * ESLint config — see TECH_SPEC.md §11.1.
 *
 * - `@react-native/eslint-config` provides the React Native / Hermes baseline.
 * - `eslint-plugin-import` enforces import ordering and the Clean Architecture
 *   layer boundaries via `no-restricted-paths` (TECH §2.3).
 * - `eslint-config-prettier` is last to disable rules that conflict with Prettier.
 */
module.exports = {
  root: true,
  extends: ['@react-native', 'plugin:import/recommended', 'plugin:import/typescript', 'prettier'],
  plugins: ['import', 'react-hooks'],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    project: false,
  },
  settings: {
    'import/resolver': {
      typescript: { project: './tsconfig.json' },
      node: { extensions: ['.js', '.jsx', '.ts', '.tsx'] },
    },
  },
  ignorePatterns: [
    'node_modules/',
    '.expo/',
    'dist/',
    'babel.config.js',
    'metro.config.js',
    '.eslintrc.cjs',
    '*.config.js',
  ],
  rules: {
    'import/order': [
      'warn',
      {
        groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
        pathGroups: [{ pattern: '@/**', group: 'internal', position: 'before' }],
        pathGroupsExcludedImportTypes: ['builtin'],
        'newlines-between': 'always',
        alphabetize: { order: 'asc', caseInsensitive: true },
      },
    ],
    'import/no-unresolved': 'off',
    'import/no-named-as-default': 'off',
    'import/no-named-as-default-member': 'off',
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
    /**
     * Inline / unused style rules from @react-native/eslint-config flag a lot of
     * BIZ-230 mockup code that is intentionally inline. Disable at the project
     * level for now; tighten when the mockup screens are migrated to the new
     * Clean Architecture layout in M1-* follow-ups.
     */
    'react-native/no-inline-styles': 'off',
    'react-native/no-unused-styles': 'off',
    'react-native/sort-styles': 'off',
    /**
     * Clean Architecture layer boundary enforcement (TECH §2.3).
     * - domain layer: pure TS, must not import RN/Expo/UI/infra/application/lib.
     * - application layer: may import domain only; must NOT import infrastructure
     *   (use ports/interfaces instead) or ui.
     * - infrastructure layer: must not import application stores or ui — wire-up
     *   happens at the composition root (app/_layout).
     */
    'import/no-restricted-paths': [
      'error',
      {
        zones: [
          {
            target: './src/domain',
            from: ['./src/application', './src/infrastructure', './src/ui', './src/lib', './app'],
            message: 'domain layer must be pure (no app/infra/ui/lib imports)',
          },
          {
            target: './src/application',
            from: ['./src/infrastructure', './src/ui', './app'],
            message: 'application must depend on ports, not on infrastructure/ui directly',
          },
          {
            target: './src/infrastructure',
            from: ['./src/application', './src/ui', './app'],
            message: 'infrastructure must not import application/ui — wire it at the composition root',
          },
        ],
      },
    ],
  },
  overrides: [
    {
      files: ['*.ts', '*.tsx'],
      rules: {
        'no-undef': 'off',
      },
    },
    {
      /**
       * `(main)` screens use the expo-router `headerLeft` / `headerRight`
       * render-prop pattern, which ESLint flags as an "unstable nested
       * component" even though it is the documented API. Mockup screens
       * (inbox / chat) additionally use inline FlatList renderItems pending
       * BIZ-266 / BIZ-267 cleanup. Suppress the rule for this group only.
       */
      files: [
        'app/(main)/inbox.tsx',
        'app/(main)/buddies.tsx',
        'app/(main)/chat/**',
        'app/(main)/add-buddy/**',
      ],
      rules: {
        'react/no-unstable-nested-components': 'off',
      },
    },
    {
      /** Tests get any/require freely; layer-boundary rule still applies via main config. */
      files: ['__tests__/**/*.ts', '__tests__/**/*.tsx'],
      rules: {
        'import/no-restricted-paths': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-var-requires': 'off',
      },
    },
    {
      /**
       * The current relay-backed prototype wires infrastructure at app/application
       * bridge points while the older port split is being replaced. Keep the
       * boundary rule active for pure domain/UI code, but do not fail lint on
       * these composition-adjacent files.
       */
      files: [
        'src/application/stores/addBuddyDraft.ts',
        'src/application/stores/artifacts.ts',
        'src/application/stores/auth.ts',
        'src/application/stores/forms.ts',
        'src/application/stores/notifications.ts',
        'src/application/stores/tasks.ts',
        'src/application/usecases/buddies/addBuddy.ts',
        'src/application/usecases/buddies/types.ts',
        'src/application/usecases/chat/types.ts',
        'src/application/usecases/session.ts',
        'src/infrastructure/receive/ReceiveSource.ts',
      ],
      rules: {
        'import/no-restricted-paths': 'off',
      },
    },
  ],
};
