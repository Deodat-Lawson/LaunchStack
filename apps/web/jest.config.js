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
  transformIgnorePatterns: [
    'node_modules/(?!(react-markdown|remark-gfm|remark-math|rehype-katex|unified|bail|is-plain-obj|trough|vfile|unist-.*|micromark.*|mdast.*|hast-.*|decode-named-character-reference|character-entities|property-information|hast-util-whitespace|space-separated-tokens|comma-separated-tokens|ccount|escape-string-regexp|markdown-table)/)',
  ],
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