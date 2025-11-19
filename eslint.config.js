/**
 * Root ESLint configuration for Lazuli monorepo
 * This config is used by lint-staged for pre-commit hooks
 */

const tsEslint = require('typescript-eslint');

module.exports = tsEslint.config(
  {
    // Global ignores for the entire monorepo
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/build/**',
      '**/.turbo/**',
      '**/out/**',
      // Ignore app-specific configs since they have their own
      'apps/web/**',
      // Ignore config files themselves
      '**/*.config.js',
      '**/*.config.mjs',
      '**/*.config.cjs',
    ],
  },
  ...tsEslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-non-null-assertion': 'warn',
    },
  }
);
