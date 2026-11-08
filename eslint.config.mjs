import js from '@eslint/js'

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
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        queueMicrotask: 'readonly',
        structuredClone: 'readonly',
        Response: 'readonly',
        TextEncoder: 'readonly',
        ReadableStream: 'readonly',
        Headers: 'readonly',
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
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        TextDecoder: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off'
    }
  },
  {
    // The SDK is an ES module meant for Node and browsers, unlike the CommonJS server.
    files: ['sdk/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: { crypto: 'readonly' }
    }
  },
  {
    // The documentation site's page scripts run in a browser, not in Node.
    files: ['scripts/site/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        document: 'readonly',
        window: 'readonly',
        matchMedia: 'readonly',
        requestAnimationFrame: 'readonly',
        getComputedStyle: 'readonly',
        ResizeObserver: 'readonly'
      }
    }
  },
  {
    ignores: ['node_modules/', 'examples/sample.db']
  }
]
