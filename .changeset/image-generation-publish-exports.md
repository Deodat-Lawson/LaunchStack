---
"@launchstack/llm": patch
"@launchstack/tools": patch
---

Publish `@launchstack/llm/images` and `@launchstack/tools/image-generation`.
Both subpaths were in the workspace `exports` map but missing from
`publishConfig.exports`. `tools/image-generation` imports `llm/images`, so
the published tool could not load until both were published.
