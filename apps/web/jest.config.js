/** @type {import('jest').Config} */
export const config = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.(ts|tsx|js|jsx|mjs)$': [
      'babel-jest',
      { configFile: './jest.babel.config.cjs' },
    ],
  },
  transformIgnorePatterns: [
    'node_modules/(?!(react-markdown|remark-gfm|remark-math|rehype-katex|unified|bail|is-plain-obj|trough|vfile|unist-.*|micromark.*|mdast.*|hast-.*|decode-named-character-reference|character-entities|property-information|hast-util-whitespace|space-separated-tokens|comma-separated-tokens|ccount|escape-string-regexp|markdown-table)/)',
  ],
  // If you keep this, leave as-is
  moduleNameMapper: {
    '^~/(.*)$': '<rootDir>/src/$1',
    '\\.(css|less|scss|sass)$': '<rootDir>/__mocks__/styleMock.js',
  },
  moduleDirectories: ['node_modules', 'src'],
  testMatch: ['**/__tests__/**/*.(test|spec).[jt]s?(x)'],
  verbose: true,
};

export default config;