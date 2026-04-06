import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        fetch: 'readonly',
        performance: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        Promise: 'readonly',
        Map: 'readonly',
        Set: 'readonly',
        Error: 'readonly',
        JSON: 'readonly',
        Object: 'readonly',
        Array: 'readonly',
        parseInt: 'readonly',
        parseFloat: 'readonly',
        encodeURIComponent: 'readonly',
        decodeURIComponent: 'readonly',
        globalThis: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off',
    },
  },
  {
    ignores: ['node_modules/', 'examples/sample.db'],
  },
];
