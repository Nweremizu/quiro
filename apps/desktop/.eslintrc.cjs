module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs'],
  parser: '@typescript-eslint/parser',
  plugins: ['react-refresh'],
  rules: {
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],
    '@typescript-eslint/no-unused-vars': ['error', {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      caughtErrorsIgnorePattern: '^_',
    }],
  },
  overrides: [
    {
      // Vendored AI Elements components (shadcn registry). They ship helper
      // utilities alongside components by design; keep them regenerable rather
      // than fighting the fast-refresh rule on every `ai-elements add`.
      files: ['src/components/ai-elements/**/*.{ts,tsx}'],
      rules: {
        'react-refresh/only-export-components': 'off',
      },
    },
    {
      // Vendored shadcn/ui primitives, same reasoning as ai-elements above: the
      // registry ships `xVariants` (cva) next to each component, and cva calls
      // aren't literals so `allowConstantExport` doesn't cover them. Splitting
      // them out would break `shadcn add` regeneration.
      files: ['src/components/ui/**/*.{ts,tsx}'],
      rules: {
        'react-refresh/only-export-components': 'off',
      },
    },
    {
      // Context providers colocated with their consumer hook (useTheme,
      // useI18n, ...). Satisfying the rule needs a three-file split per context
      // — the extracted hook has to import the context object, which is itself
      // a non-component export — across ~43 consumers, for a dev-only HMR win.
      files: [
        'src/contexts/**/*.{ts,tsx}',
        'src/components/launch/popovers/LaunchPopoverCoordinator.tsx',
      ],
      rules: {
        'react-refresh/only-export-components': 'off',
      },
    },
  ],
}
