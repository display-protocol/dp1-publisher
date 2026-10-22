import eslint from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'dist',
      'node_modules',
      'tailwind.config.js',
      'postcss.config.js',
      'vite.config.ts',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
  {
    // ff-indexer-v2 is deprecated (feral-file/feral-file#3576): its client stays in the
    // tree unused, and only its own modules and tests may reference it.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/lib/indexerApi*.ts', 'src/lib/indexerToPlaylistItem*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/lib/indexerApi', '@/lib/indexerToPlaylistItem', '**/indexerApi', '**/indexerToPlaylistItem'],
              message: 'ff-indexer-v2 is deprecated; load series through @/lib/vendors.',
            },
          ],
        },
      ],
    },
  },
)
