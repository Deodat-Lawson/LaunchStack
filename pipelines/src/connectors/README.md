# @launchstack/features/connectors

Data connectors that register external bodies of knowledge as ingestion
sources.

Every connector produces a flat list of `KnowledgeItem`s and hands them to a
host-supplied `KnowledgeSink` (`types.ts`). Connectors never touch the database
or blob storage directly — that keeps this package free of `apps/web` imports
and makes each connector testable against an in-memory sink.

## agent-knowledge — Claude Code & Codex

`agent-knowledge/` reads the knowledge those two coding agents already keep on
disk and uploads it. There is no OAuth handshake and no polling loop: the
source is the local filesystem, so a sync is immediate.

What it picks up:

| Tool        | Global (`~`)                                                                                                                        | Per project                                                                             |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Claude Code | `.claude/CLAUDE.md`, `.claude/MEMORY.md`, `agents/`, `commands/`, `skills/`, `memory/`, `output-styles/`, `projects/<slug>/memory/` | `CLAUDE.md`, `CLAUDE.local.md`, `.claude/{agents,commands,skills,memory,output-styles}` |
| Codex       | `.codex/AGENTS.md`, `.codex/instructions.md`, `prompts/`, `memories/`                                                               | `AGENTS.md`, `.codex/{AGENTS.md,prompts,memories}`                                      |

`projects/<slug>/memory/` is the one place the connector reaches into
`~/.claude/projects/`, which otherwise holds session transcripts. It is a
`nested` layout entry — one fixed subdirectory of each slug, never a recursive
walk — so the `.jsonl` transcripts sitting beside it stay out of reach.

```ts
import { syncAgentKnowledge } from "@launchstack/features/connectors/agent-knowledge";

const report = await syncAgentKnowledge({
  projects: [{ dir: "/srv/checkouts/launchstack" }],
  sink: myKnowledgeSink,
});
```

`scanAgentKnowledge()` is the cheap half — it stats files without opening them,
so a UI can preview exactly what a sync would upload.

### What it deliberately does not read

Both tools mix authored knowledge with machine state under the same roots, so
discovery is **allowlist-driven**: a path that is not named in `layout.ts`
cannot be picked up. On top of that:

- Credential files (`.credentials.json`, `auth.json`, `.env*`, `*.pem`,
  `*.key`, anything matching `secret`/`token`/`credential`) are denylisted by
  name, whatever their extension.
- Config files (`settings.json`, `config.toml`) hold API keys, so they are
  behind `includeConfig` and off by default.
- Session transcripts, caches, sqlite journals, `sessions/`, `history.jsonl`
  and friends are never walked — including everything under `projects/` except
  the `memory/` subdirectory described above.
- `~/.claude/plugins/` is skipped. Marketplace plugins are third-party
  published content and a multi-megabyte checkout, not the user's own
  knowledge.
- Symlinks are never followed, and the walk cannot leave the root it started
  in.
- Files over 512 KiB, empty files, and files containing NUL bytes are skipped
  with a reason rather than uploaded.

Everything declined shows up in the report's `skipped` array with its reason —
a sync never silently under-reports.

### Change detection

`sourceId` (`agent-knowledge://<tool>/<scope>/<relative-path>`) is the stable
identity of an item across syncs and carries no absolute paths, so it survives
a home directory move. The sink's optional `lastSyncedHash()` lets a re-sync
skip files whose sha256 has not changed; hosts that do not implement it just
re-upload every time, which is slower but always correct.

## Future connectors

Third-party sources (Google Drive, SharePoint, Notion, Slack) will authenticate
through Nango and implement the same `KnowledgeSink` contract, so the ingestion
path stays unified.
