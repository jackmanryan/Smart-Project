export default [
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        window: 'readonly', document: 'readonly', location: 'readonly', history: 'readonly',
        localStorage: 'readonly', sessionStorage: 'readonly', navigator: 'readonly',
        console: 'readonly', fetch: 'readonly', XMLHttpRequest: 'readonly', FormData: 'readonly',
        URL: 'readonly', URLSearchParams: 'readonly', DOMParser: 'readonly', performance: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
        requestAnimationFrame: 'readonly', requestIdleCallback: 'readonly', queueMicrotask: 'readonly',
        MutationObserver: 'readonly', ResizeObserver: 'readonly', IntersectionObserver: 'readonly',
        CustomEvent: 'readonly', Event: 'readonly', AbortController: 'readonly', Node: 'readonly',
        HTMLElement: 'readonly', Element: 'readonly', getComputedStyle: 'readonly', matchMedia: 'readonly',
        Blob: 'readonly', Response: 'readonly', Request: 'readonly', Headers: 'readonly', FileReader: 'readonly', TextDecoder: 'readonly', atob: 'readonly', btoa: 'readonly',
        GM_addStyle: 'readonly', GM_xmlhttpRequest: 'readonly', GM_setValue: 'readonly',
        GM_getValue: 'readonly', GM_setClipboard: 'readonly', GM_saveTab: 'readonly',
        GM_getTab: 'readonly', GM_addValueChangeListener: 'readonly', GM_info: 'readonly',
        __BUNDLE_NAME__: 'readonly', __BUNDLE_VERSION__: 'readonly',
        process: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['error', { args: 'none', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  { ignores: ['dist/**', 'legacy/**', 'node_modules/**', 'docs/site-reference/**', 'src/modules/nav/nav-ux.js'] },
];
