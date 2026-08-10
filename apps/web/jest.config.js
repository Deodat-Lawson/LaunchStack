/**
 * Packages published as ESM only, which Babel therefore has to transform.
 *
 * Entries are regex fragments matching the package name.
 */
const esmOnlyPackages = [
  'react-markdown',
  'remark-gfm',
  'remark-math',
  'rehype-katex',
  'unified',
  'bail',
  'is-plain-obj',
  'trough',
  'vfile',
  'unist-.*',
  'micromark.*',
  'mdast.*',
  'hast-.*',
  'decode-named-character-reference',
  'character-entities',
  'property-information',
  'hast-util-whitespace',
  'space-separated-tokens',
  'comma-separated-tokens',
  'ccount',
  'escape-string-regexp',
  'markdown-table',
  // Reached through the editor: @tiptap/extension-unique-id → uuid,
  // @tiptap/extension-code-block-lowlight → lowlight → devlop.
  'uuid',
  'lowlight',
  'devlop',
];

/**
 * pnpm stores a package at `node_modules/.pnpm/<name>@<version>/node_modules/<name>`,
 * and this pattern is tested against the whole path — so the outer
 * `node_modules/.pnpm/…` segment matches and the file is skipped unless the
 * `.pnpm/<name>@` prefix is allowlisted alongside the bare name.
 */
const allowlist = [
  ...esmOnlyPackages,
  ...esmOnlyPackages.map((name) => `\\.pnpm/${name}@[^/]+/`),
].join('|');

/** @type {import('jest').Config} */
export const config = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/jest.setup.ts'],
  transform: {
    '^.+\\.(ts|tsx|js|jsx|mjs)$': [
      'babel-jest',
      { configFile: './jest.babel.config.cjs' },
    ],
  },
  transformIgnorePatterns: [`node_modules/(?!(${allowlist})/?)`],
  // Keep ~/* pointed at apps/web src. The @launchstack/* mappings resolve the
  // workspace subpaths (e.g. @launchstack/core/ocr/trigger → the TS source)
  // so jest doesn't have to hit the built dist/.
  moduleNameMapper: {
    '^~/(.*)$': '<rootDir>/src/$1',
    '^@launchstack/core$': '<rootDir>/../../packages/core/src/index.ts',
    '^@launchstack/core/(.*)$': '<rootDir>/../../packages/core/src/$1',
    '^@launchstack/features$': '<rootDir>/../../packages/features/src/index.ts',
    '^@launchstack/features/(.*)$': '<rootDir>/../../packages/features/src/$1',
    '\\.(css|less|scss|sass)$': '<rootDir>/__mocks__/styleMock.js',
  },
  moduleDirectories: ['node_modules', 'src'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'mjs', 'cjs'],
  testMatch: ['**/__tests__/**/*.(test|spec).[jt]s?(x)'],
  verbose: true,
};

export default config;
