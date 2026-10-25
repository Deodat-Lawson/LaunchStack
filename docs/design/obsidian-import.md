# Obsidian vault import

**Status:** Implemented
**Date:** 2026-10-23

## The decision

Obsidian has no cloud API and no OAuth: a vault is a folder of Markdown files
on someone's disk. Neither Claude nor ChatGPT has an Obsidian connector;
people wire up local MCP servers or community plugins. So "connect Obsidian"
here is an **import you can repeat**: Add source › Obsidian, pick the vault's
folder (or a .zip of it), and pick it again later to bring changes in.

A LaunchStack plugin for Obsidian, with a Connect button and live sync, is
the upgrade path. It is a separate package with its own review by Obsidian,
and the import already covers the common case.

A vault is one person's notes, so the gate is `documents.upload` (anyone who
can add files) and the privacy model is Gmail's: `Obsidian/<vault>` is
restricted with a manage grant for the importer, and the `Obsidian` root is
restricted with no grants. Each person sees their own vaults and can share
one when they choose.

## Shape

```
browser: ObsidianImportPanel
   reads the folder (webkitdirectory) or .zip (jszip)
   keeps notes only ─ obsidian/paths (shared with the server)
   │
   ├─▶ POST /api/connectors/obsidian/import          ≤200 notes / ~4 MB per batch
   │      importVaultBatch → importObsidianNotes → KnowledgeSink → document lifecycle
   └─▶ POST /api/connectors/obsidian/import/finish   every path the vault still has
          flag notes imported before that are gone (obsidianDeleted)
```

`pipelines/src/connectors/obsidian` is framework-free:

- **`paths.ts`** (browser-safe) decides what a note is: `.md` files, but not
  anything under a dot-folder (`.obsidian/`, `.trash/`, `.git/`) or
  `node_modules/`, and not Excalidraw drawings (JSON in a `.md` file).
- **`vault.ts`** renders Obsidian's dialect for reading and retrieval:
  - frontmatter becomes a property list under the title;
  - `[[Note|alias]]` reads as its alias, and `[[Note#Heading]]` as `Note › Heading`;
  - `![[embeds]]` say what was embedded;
  - `%% comments %%` and `^block-ids` are dropped;
  - fenced code is left exactly as written.
- **`import.ts`** fingerprints each note by its own bytes (sha256), so
  re-importing an untouched vault stores nothing.

A note's identity is (importer, vault name, vault-relative path). Re-importing
under the same vault name updates the same documents; the vault's folders are
rebuilt beneath `Obsidian/<vault>` within the folder limits (depth 8, 80
characters per name, 256 per path). If two people both have a vault called
"Notes", the second gets `Obsidian/Notes (2)`, found again on every re-import
by its grant.

## Limits

Notes over 2 MB and empty notes are skipped and reported. Attachments
(images, PDFs) are not imported; an embed of one reads as `[media: name]`.
Deletions are noticed only by the finish call, so an import that stops partway
flags nothing.
