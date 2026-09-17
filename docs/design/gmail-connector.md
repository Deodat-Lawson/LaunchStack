# Gmail connector

**Status:** Implemented
**Date:** 2026-09-08

## The decision

Gmail is the first **per-user** connector. Every other workspace connection
(Google Drive, Slack, GitHub) belongs to the company: an admin grants it and
whatever it syncs is company knowledge. A mailbox is not company knowledge.
It is one person's, so:

- A member connects their own Gmail, per workspace. The connection row is
  owned by them (`connector_connections.owner_user_id`), one per member per
  workspace, and dies with their account.
- The gate is `documents.upload`, not `connectors.manage`. Connecting Gmail
  adds documents to the member's own folder, which is what upload means.
- The threads land in `Gmail/<address>`, a restricted folder with a single
  `manage` grant to the owner. The `Gmail` root is restricted with no grants
  so nobody sees an empty folder they cannot open. Under ADR-010 the nearest
  restricted ancestor decides, so the owner sees their folder and no one
  else's; retrieval and the post-retrieval gate enforce the same scope.
- Company folders stay the place for what the team shares. Moving a synced
  thread into a shared folder is an explicit act by its owner.

Holders of `folders.manage` (Owners and Admins) see every restricted folder,
Gmail ones included, exactly as they see a Finance folder. That is the stated
model, not an oversight. A tier that hides a folder even from folder admins
would be a change to `DocumentScope`, and this feature does not make it.

## Shape

```
member ──connect──▶ /api/connectors/google/oauth/start?provider=gmail
                          │  gmail.readonly + openid + email
                          ▼
                    google/oauth/callback  (state prefix "gmail." picks the flow)
                          │  upsert own row · create private folder · audit
                          ▼
   GmailConnectPanel ──▶ /api/connectors/gmail          status · disconnect
                         /api/connectors/gmail/labels   live label list
                         /api/connectors/gmail/items    labels + searches to sync
                         /api/connectors/gmail/sync     "sync now" → Inngest event
                                                             │
                                             worker: gmailSyncJob (per connection, serialized)
                                                     gmailSyncCron (every 15 min, fan-out)
                                                             │
                                  pipelines/src/connectors/gmail  (framework-free)
                                    client · discover · render · collect · sync
                                                             │  KnowledgeSink
                                  apps/web/services/connectors/gmail/sink → document lifecycle
```

The OAuth client is the one Drive uses. A Gmail grant is always its own
connection row, so a workspace's Drive admin is never asked for mailbox
access, and a member's Gmail never becomes a company credential
(`getCompanyAccessToken("gmail")` returns null by design).

## What syncs, and what it costs

The member chooses **labels** and/or **Gmail searches**. Under
`gmail.readonly` the app could read everything; the chosen scope is the
entire universe the sync touches.

One thread becomes one Markdown document: subject, participants, dates,
labels, a link back to Gmail, then each message with its headers and body
(text/plain preferred, HTML converted, quoted replies trimmed, drafts
dropped). Ingestible attachments (PDF, Word, Excel, PowerPoint, text, CSV)
become their own documents; images do not, or every signature logo would.

Cost is proportional to change:

| Situation                                  | Gmail API calls                                     |
| ------------------------------------------ | --------------------------------------------------- |
| Nothing happened since the last run        | 2 (profile + one empty history page)                |
| Some threads changed                       | list per selector + `minimal` get per changed thread + `full` get per thread whose message set changed |
| Read/unread or label flips only            | `minimal` get per touched thread, nothing stored    |
| First run, forced run, or expired history  | list per selector + one `full` get per thread       |

The identity of a thread is the set of its non-draft message ids
(`msgs:<sha256>`), not Gmail's `historyId`. Messages are immutable, so a
reply changes the identity and a label change does not. This is what keeps
opening an email from re-embedding it.

The cursor is the mailbox `historyId`, taken before the walk so mid-sync
changes replay next run. Gmail keeps roughly a week of history; an expired
cursor triggers a full walk, which is also the only kind of run that can say
what is gone. Documents whose thread left the scope are flagged
(`gmailDeleted`), never deleted.

## Operator setup

1. On the GCP project that holds the Drive OAuth client, enable the Gmail
   API and add `https://www.googleapis.com/auth/gmail.readonly` to the
   consent screen. It is a **restricted** scope: an External app in
   production needs Google's verification plus a CASA assessment; an
   Internal app (one Google Workspace) needs neither; an app in Testing
   mode issues refresh tokens that expire after seven days, which breaks a
   background sync.
2. Set `GMAIL_CONNECTOR_ENABLED=true`. The Google client pair and
   `EMBEDDING_SECRETS_KEY` are already required by Drive.

Nothing changes for deployments that leave the flag off: the Gmail tile
reads "not enabled on this server".

## Alternatives rejected

- **Workspace-scoped Gmail, like Drive.** One admin pouring their mailbox
  into the shared corpus is the wrong default for mail; the user asked for
  per-user.
- **A separate per-user corpus.** Restricted folders already give per-user
  visibility with zero authz changes and full retrieval enforcement.
- **`historyId` as the thread fingerprint.** It moves on every label flip,
  so reading an email would create a new document version.
- **The `googleapis` SDK.** The connector needs six endpoints; every other
  provider in the repo is a thin typed fetch client.
