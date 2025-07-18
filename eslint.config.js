const globals = require('globals')
const prettier = require('eslint-config-prettier')

module.exports = [
  {
    ignores: ['**/lib/**', '**/dist/**']
  },
  prettier,
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node
      },
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
      }
    },
    rules: {
      semi: ['error', 'never'],
      quotes: ['error', 'single'],
      'comma-dangle': ['error', 'never'],
      'prettier/prettier': [
        'error',
        {
          semi: false,
          singleQuote: true,
          trailingComma: 'none'
        }
      ],
      // Enforce strict equality except for null/undefined checks
      eqeqeq: ['error', 'always', { null: 'ignore' }]
    },
    plugins: {
      prettier: require('eslint-plugin-prettier')
    }
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: {
      '@typescript-eslint': require('@typescript-eslint/eslint-plugin'),
      react: require('eslint-plugin-react'),
      'react-hooks': require('eslint-plugin-react-hooks')
    },
    rules: {
      // Prevent use of 'any' type
      '@typescript-eslint/no-explicit-any': 'error'
    },
    languageOptions: {
      parser: require('@typescript-eslint/parser'),
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true
        }
      }
    },
    settings: {
      react: {
        version: 'detect'
      }
    }
  }
]
