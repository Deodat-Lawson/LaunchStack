/** @type {import('prettier').Config & import('prettier-plugin-tailwindcss').PluginOptions} */
const config = {
  plugins: ["prettier-plugin-tailwindcss"],
  printWidth: 100,
  tabWidth: 4,
  useTabs: false,
  semi: true,
  singleQuote: false,
  quoteProps: "as-needed",
  trailingComma: "es5",
  bracketSpacing: true,
  bracketSameLine: false,
  arrowParens: "avoid",
  endOfLine: "lf",
  embeddedLanguageFormatting: "auto",
  overrides: [
    { files: "*.json", options: { tabWidth: 2 } },
    { files: "*.yml", options: { tabWidth: 2 } },
    { files: "*.yaml", options: { tabWidth: 2 } },
    { files: "*.md", options: { tabWidth: 2, proseWrap: "preserve" } },
  ],
};

export default config;
