---
"@launchstack/pipelines": minor
---

Add the Notion and Obsidian connectors to the connectors vertical.

- **`@launchstack/pipelines/connectors/notion`**: a thin Notion API client
  (`/v1/search` for page discovery and the page Markdown endpoint for content,
  pinned to `Notion-Version: 2026-03-11`, with 429/5xx retry) and a
  `syncNotion` run under the `KnowledgeSink` contract. Change detection uses
  `last_edited_time`; every run is a full listing, so deleted or un-shared
  pages come back as `missingSourceIds`. A database row's properties render
  above its body.
- **`@launchstack/pipelines/connectors/obsidian`**: `importObsidianNotes` for
  batches of vault notes. Frontmatter, wikilinks, embeds, comments and block
  ids are rendered for reading, and a note's sha256 skips unchanged notes on
  re-import. The browser-safe path rules (`isVaultNotePath`,
  `normalizeVaultPath`, `noteFolder`) are also exported on their own at
  `@launchstack/pipelines/connectors/obsidian/paths`.
