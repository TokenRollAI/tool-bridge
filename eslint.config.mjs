// @ts-check
import { defineConfig, globalIgnores } from 'eslint/config'
import unusedImports from 'eslint-plugin-unused-imports'
import perfectionist from 'eslint-plugin-perfectionist'
import reactRefresh from 'eslint-plugin-react-refresh'
import stylistic from '@stylistic/eslint-plugin'
import reactHooks from 'eslint-plugin-react-hooks'
import importPlugin from 'eslint-plugin-import'
import tseslint from 'typescript-eslint'
import jsonc from 'eslint-plugin-jsonc'
import globals from 'globals'
import js from '@eslint/js'

export default [
  globalIgnores([
    '**/dist/',
    '**/.wrangler/',
    '**/.wxt/',
    '**/.output/',
    '**/node_modules/',
    '.llmdoc-tmp/',
    'output/',
    'archive/',
    'packages/dashboard/public/',
    'packages/dashboard/src/index.css',
  ]),
  // jsonc
  ...defineConfig({
    extends: [jsonc.configs['flat/recommended-with-jsonc']],
    files: ['**/*.json'],
  }),
  // code
  ...defineConfig({
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      stylistic.configs.customize({ braceStyle: '1tbs', indent: 2, quotes: 'single', semi: false }),
    ],
    files: ['**/*.{ts,tsx,js,mjs,cjs,jsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        parser: tseslint.parser,
      },
      sourceType: 'module',
    },
    plugins: {
      'import': importPlugin,
      perfectionist,
      'unused-imports': unusedImports,
    },
    rules: {
      '@stylistic/curly-newline': ['error', { consistent: true }],
      '@stylistic/jsx-self-closing-comp': 'error',
      '@stylistic/object-curly-newline': ['error', { consistent: true }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/no-use-before-define': 'error',
      '@typescript-eslint/unified-signatures': 'off',
      'import/no-duplicates': ['error', { 'prefer-inline': true }],
      'perfectionist/sort-enums': ['error', { type: 'natural' }],
      'perfectionist/sort-exports': ['error', { type: 'natural' }],
      'perfectionist/sort-imports': ['error', { newlinesBetween: 0, order: 'desc', type: 'line-length' }],
      'perfectionist/sort-interfaces': ['error', { type: 'natural' }],
      'perfectionist/sort-jsx-props': ['error', { type: 'natural' }],
      'perfectionist/sort-named-exports': ['error', { type: 'natural' }],
      'perfectionist/sort-named-imports': ['error', { type: 'natural' }],
      'perfectionist/sort-object-types': ['error', { type: 'natural' }],
      'perfectionist/sort-objects': ['error', { type: 'natural' }],
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': 'error',
    },
  }),
  // react（仅 dashboard）
  ...defineConfig({
    extends: [reactRefresh.configs.vite],
    files: ['packages/dashboard/**/*.{ts,tsx,js,jsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/rules-of-hooks': 'error',
    },
  }),
  // 脚本/配置文件：放开 console
  ...defineConfig({
    files: ['scripts/**', '**/*.config.{ts,mjs,js}', 'eslint.config.mjs'],
    rules: {
      'no-console': 'off',
    },
  }),
]
