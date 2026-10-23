# Notion connector

**Status:** Implemented
**Date:** 2026-10-23

## The decision

Connecting Notion should be as easy as it is in Claude or ChatGPT: click
**Connect Notion**, approve on Notion's own screen, done. Both of those
products connect to Notion's hosted MCP server (`mcp.notion.com`), which
answers live at question time. We use Notion's **public OAuth connection and
sync the pages into Sources** instead, because:

- Notion's consent screen has its own page picker, so "choose what to share"
  costs us no UI and is the same screen people already know.
- Synced pages are documents: listed in Sources, searchable, citable, and
  governed by folder access like everything else. A live MCP tool would give
  Ask no citations and the rail nothing to show.
- The hosted MCP server is for interactive agents; bulk reads through it are
  off-label.

The trade: an operator registers one public connection in Notion's developer
portal (see the [runbook](../runbooks/azure-lean-deploy.md#connecting-notion)),
which Notion reviews before anyone can authorize it.

The connection belongs to the **workspace**, as Drive's does: holders of
`connectors.manage` connect it, and what it syncs is company knowledge. Each
connected Notion workspace lands in `Notion/<workspace>`, created the way a
person creating a folder would (ADR-014): private to whoever connected it,
with a manage grant so they decide who else sees it.

## Shape

```
admin ──connect──▶ /api/connectors/notion/oauth/start        (generic provider layer)
                        │  owner=user · Notion's page picker
                        ▼
                  [provider]/oauth/callback  upsert row (bot_id) · queue first sync
                        │
 NotionConnectPanel ──▶ /api/connectors/notion/status          workspaces · folder · last run
                        /api/connectors/notion/sync?connectionId=   "Sync now" → Inngest event
                        /api/connectors/notion/oauth/start     "Choose pages" (same consent, again)
                        /api/connectors/connections/:id        disconnect + revoke
                                    │
                    worker: notionSyncJob (per connection, serialized)
                            notionSyncCron (every 15 min, fan-out)
                                    │
                pipelines/src/connectors/notion   (framework-free)
                   client · render · sync
                                    │  KnowledgeSink
                apps/web/server/services/connectors/notion/sink → document lifecycle
```

Notion plugs into the same OAuth layer as Slack, GitHub and LinkedIn
(`providers/notion.ts`). Its dialect: HTTP Basic client auth and a JSON body
on the token endpoints, `Notion-Version: 2026-03-11` on every call, and a
grant keyed on `bot_id`, which Notion guarantees unique per token. One Notion
workspace can hold several tokens, so `workspace_id` is not an identity.

## What a sync does

1. **List.** `POST /v1/search` (pages only, newest edit first, 100 per call)
   is the scope: it returns exactly what the connection may read. It is
   metadata only, so listing 1,000 pages is ten calls.
2. **Compare.** A page whose `last_edited_time` matches what is stored is
   skipped without reading it. The fingerprint is the edit time, not a hash
   of the body, because Notion re-signs file URLs on every read.
3. **Read.** `GET /v1/pages/{id}/markdown` returns the page as Notion's
   enhanced Markdown in one call. A page over Notion's record limit comes back
   truncated with `unknown_block_ids`; up to ten of those subtrees are fetched
   and spliced back in.
4. **Render.** A title, a provenance line with a link back to Notion, and,
   for a database row, its properties (status, dates, people, tags…),
   followed by the body.
5. **Store.** One page becomes one Markdown document; an edit becomes a new
   version of it.
6. **Notice what's gone.** Every run is a full listing, so a page that was
   deleted, trashed or un-shared stops appearing. Its document is flagged
   `notionDeleted`, never deleted. If it comes back, it is stored again and
   the flag clears.

| Situation                     | Notion API calls                         |
| ----------------------------- | ---------------------------------------- |
| Nothing changed               | `ceil(pages / 100)` searches             |
| Some pages edited             | the searches + one Markdown read per edited page |
| First run, or **Sync now** with force | the searches + one read per page |

Limits: 2,000 pages per connection per run (beyond that the run is marked
truncated and does not judge deletions), 2 MB per rendered page, three
requests in flight. 429s are retried after `Retry-After`.

## Tokens

Notion sends no `expires_in`, so a token is used until Notion refuses it. A
401 gets one refresh (which rotates the refresh token) and one retry. A
refresh answered `invalid_grant`, or a fresh token that still gets a 401,
marks the connection revoked, and the panel offers **Reconnect**.
`notion_sync_state` holds the lease (one run per connection), the last run's
counts, and the folder's category id, so a renamed or moved folder is
followed rather than recreated.

## Alternatives rejected

- **Notion's hosted MCP server.** No operator setup, but no page picking,
  nothing in Sources, and no citations.
- **A recursive block walk.** The Markdown endpoint returns the same content
  in one call per page instead of one call per block level.
- **Per-member connections, like Gmail.** Notion workspaces hold team
  knowledge, and the consent screen already limits reach to what the person
  picks.
- **A picked-items table, like Drive's.** Notion's search is the picked set,
  and keeping a copy would only drift from it.
