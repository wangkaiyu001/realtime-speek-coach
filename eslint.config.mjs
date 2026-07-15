import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const sharedGlobals = {
  Audio: 'readonly',
  Blob: 'readonly',
  Buffer: 'readonly',
  URL: 'readonly',
  WebSocket: 'readonly',
  atob: 'readonly',
  btoa: 'readonly',
  clearTimeout: 'readonly',
  console: 'readonly',
  crypto: 'readonly',
  document: 'readonly',
  fetch: 'readonly',
  localStorage: 'readonly',
  location: 'readonly',
  navigator: 'readonly',
  process: 'readonly',
  require: 'readonly',
  setTimeout: 'readonly',
  window: 'readonly',
  wx: 'readonly',
};

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.pnpm-store/**',
      'prisma/dev.db*',
      'prisma/test.db*',
    ],
  },
  {
    files: ['**/*.{js,cjs,mjs,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: sharedGlobals,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-empty': 'off',
      'no-undef': 'off',
      'no-unused-vars': 'off',
    },
  },
);
