# Microsoft 365 connectors: OneDrive, SharePoint and Outlook

**Status:** Implemented, verified against a local stand-in only (no real tenant yet)
**Date:** 2026-11-12

## The decision

Professional-services firms keep their work in Microsoft 365. Two connectors
bring it in, each following the Google connector it mirrors:

|                        | `microsoft-365` (files)                                                           | `outlook` (mail)                                         |
| ---------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Mirrors                | Google Drive                                                                      | Gmail                                                    |
| Belongs to             | the workspace, one connection                                                     | one member, one mailbox each                             |
| Gate                   | `connectors.manage`                                                               | `documents.upload`                                       |
| Lands in               | the folder chosen in Add a source; a picked folder is rebuilt with its subfolders | `Outlook/<address>`, private to its owner                |
| Scopes                 | `Files.Read.All Sites.Read.All`                                                   | `Mail.Read`                                              |
| Leaves with the member | no, it is company knowledge                                                       | yes: connection, sync state, mail and folder are deleted |

Both add `offline_access openid email profile`. Everything is delegated and
read-only: LaunchStack sees what the person who connected can see and never
writes to Microsoft 365.

A file grant and a mail grant are always separate connection rows, so the
admin who connects SharePoint is never asked for mailbox access and a
member's mailbox never becomes a company credential.

## Shape

```
Add a source ─▶ /api/connectors/microsoft/oauth/start[?provider=outlook]
                     │  Entra v2.0 authorize (tenant: common, or the pinned one)
                     ▼
               /api/connectors/microsoft/oauth/callback   (state prefix "outlook." picks the flow)
                     │  upsert row · encrypted refresh token · audit
        ┌────────────┴─────────────┐
        ▼                          ▼
 /api/connectors/microsoft-files   /api/connectors/outlook
   status · items · browse          (status, disconnect) · folders · items · sync
   sync · deleted                          │
        │                                  │
 worker: microsoft365SyncJob/Cron   worker: outlookSyncJob/Cron      (every 15 min, offset)
        │                                  │
 pipelines/src/connectors/microsoft-365    pipelines/src/connectors/outlook   (framework-free)
        │  KnowledgeSink                   │  KnowledgeSink
 services/connectors/microsoft-365/sink    services/connectors/outlook/sink  ─▶ document lifecycle
```

`apps/web/src/server/services/microsoft/` is the shared layer: configuration,
the OAuth exchange and refresh, and token storage with rotation. The route
folder is `microsoft-files`, not `microsoft-365`, because the rate limiter
reads any path segment containing a digit as an id; the provider id is still
`microsoft-365`.

Microsoft offers no hosted picker we can embed without loading its script
into the app, so picking is a pasted sharing link (resolved through
`/shares/{id}`) or a built-in browser over My OneDrive and SharePoint site
search.

## How sync decides what to do

**Files.** There is no change cursor. Each run walks the picked files and
folders and compares Graph's `cTag` with the one stored on the document:
unchanged files are skipped, changed files become a new version, files no
longer in Microsoft are flagged as missing (only when the walk was complete),
and files deleted in LaunchStack are remembered in `connector_deleted_item`
and never re-imported until someone chooses "Sync again".

**Mail.** Each chosen folder keeps its own Graph delta link. One conversation
becomes one Markdown document (drafts dropped, quoted replies trimmed);
PDF, Office, text and CSV attachments become their own documents. When a
delta link expires the folder is walked again from scratch. A run that sees
removed messages follows with a full re-walk so missing conversations are
flagged.

## Tables

`microsoft365_sync_state`, `microsoft365_picked_item`, `outlook_sync_state`
(delta links per folder) and `outlook_sync_scope`, plus a second partial
unique index on `connector_connections` so a member has at most one Outlook
connection per workspace. Gmail's index is untouched. The migration is
additive DDL only.

## Disconnecting

Microsoft gives a confidential client no endpoint to revoke a delegated
grant. Disconnect therefore deletes the row and its encrypted token, stops
the sync and says plainly that the permission stays listed in the Microsoft
account until it is removed there. Imported documents are kept.

## Operator setup

One Entra app registration serves both connectors (separate from the sign-in
app, as Google's is): `MICROSOFT_OAUTH_CLIENT_ID`,
`MICROSOFT_OAUTH_CLIENT_SECRET`, optional `MICROSOFT_OAUTH_TENANT_ID`
(default `common`), and `OUTLOOK_CONNECTOR_ENABLED=true` to offer mail.
Redirect URI: `<origin>/api/connectors/microsoft/oauth/callback`. Many
tenants require an administrator to consent to `Files.Read.All` and
`Sites.Read.All` first. Without the variables both connectors report "not
configured". See `.env.example` and the deployment guide.

## Developing without a Microsoft account

`MICROSOFT_STAND_IN_URL=<origin>/dev/stand-ins/microsoft` points both the
OAuth endpoints and Graph at a local stand-in: a consent screen with two
accounts at a sample firm, OneDrive and SharePoint libraries, two mailboxes,
and buttons to edit or remove a file, deliver a reply, revoke consent and
expire delta links. It is served only when dev routes are enabled.

## Not done

Teams chat and calendar; app-only access with `Sites.Selected`; writing
Office files back; client/matter filing; and verification against a real
tenant (throttling, admin-consent screens and real sharing-link shapes are
exercised only by the stand-in and tests).
