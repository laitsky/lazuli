/**
 * ESLint configuration for Lazuli React applications
 * Extends the base configuration with React-specific rules
 */

const tsEslint = require('typescript-eslint');

module.exports = tsEslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/build/**'],
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
      'react/react-in-jsx-scope': 'off', // Not needed with React 17+ JSX transform
      'react/prop-types': 'off', // Using TypeScript
    },
  }
);
