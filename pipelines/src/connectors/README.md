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
  the `memory/` subdirectory described above. (Importing transcripts is the
  agent-sessions connector's job, below — deliberately a separate connector
  with its own policy and limits.)
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

## agent-sessions — Claude Code & Codex transcripts

`agent-sessions/` imports the one thing agent-knowledge refuses: finished
session transcripts. Sources:

| Tool        | Location                                                                        |
| ----------- | ------------------------------------------------------------------------------- |
| Claude Code | `~/.claude/projects/<slug>/<session-uuid>.jsonl`                                |
| Codex       | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` (+ `archived_sessions/`), titles from `session_index.jsonl` |

A raw transcript is mostly tool traffic, so each session is parsed
(`parse-claude.ts` / `parse-codex.ts`) into a `NormalizedSession` and rendered
to a Markdown transcript (`render.ts`) before upload:

- user and assistant prose are kept in full, under per-turn headings that line
  up with the heading-aware chunker;
- tool calls become one-line summaries and tool output is truncated at 1,000
  chars — this is what keeps a 45 MB session file rendering to a few hundred
  KB;
- thinking/reasoning blocks, subagent sidechains and harness bookkeeping are
  dropped and counted, and the counts appear in the rendered provenance header;
- unrecognized record types are counted as `unknown` — the drift signal for
  when a CLI update changes the format ahead of the parser.

Discovery is newest-first and bounded (`maxSessions`, default 200), skips
files over 64 MiB, and leaves files modified in the last five minutes alone
(`skipped: "active"`) — a live session would otherwise mint a document version
per prompt. `sourceId` is `agent-sessions://<tool>/<session-uuid>`, so a
re-import converges on the documents it already created; a session that grew
becomes a new version of its document.

```ts
import { syncAgentSessions } from "@launchstack/pipelines/connectors/agent-sessions";

const report = await syncAgentSessions({ sink: myKnowledgeSink });
```

## Future connectors

Third-party sources (Google Drive, SharePoint, Notion, Slack) will authenticate
through Nango and implement the same `KnowledgeSink` contract, so the ingestion
path stays unified.
