# ADR-016: Public Links for Files

**Status:** Accepted
**Date:** 2026-11-21
**Deciders:** Repository maintainers
**Amends:** ADR-014 (which left "Public links" out)

## Context

Everything in a workspace is reachable only by signed-in members (ADR-014).
People want to send one file to someone outside the workspace — a customer,
an investor, a contractor — or paste it into an AI agent (Claude, ChatGPT, a
coding agent) without exporting and re-uploading it. Drive, Notion and
Dropbox all answer this with "anyone with the link".

An agent is a different reader from a person. It usually fetches a URL
without running JavaScript, and reads Markdown best. A link that only works
in a browser after the app hydrates is a blank page to it.

## Decision

### 1. One secret link per file

- `document_public_links`: at most one live row per document (partial unique
  index on `document_id WHERE revoked_at IS NULL`). The token is 32 random
  bytes as base64url (256 bits), stored as-is so a manager can copy the link
  again, as in Drive.
- A link is **live** while it is not turned off, not past `expires_at`, its
  file exists (the row cascades with the document), and the workspace switch
  is on. Every public read starts from `resolvePublicLink(token)`, and every
  failure is the same 404, so a caller cannot tell a turned-off link from a
  token that never existed.
- **Live, not a snapshot.** A link shows the file's current version. A
  mindmap is the exception: its document is the published copy, so the link
  draws the revision that copy was made from (from the map's history, or the
  map itself while nothing has been saved since). It never draws unpublished
  edits; when it cannot draw the published revision it shows the published
  outline.
- Turning a link off keeps the row with `revoked_at`; making a new link
  mints a new token, so an old URL never comes back.
- Expiry is never, 7 or 30 days, counted from when it is set. Download is on
  by default. Off removes the button and refuses `?download=1`; it cannot stop
  someone saving what their browser shows, and the dialog does not pretend it
  can.

### 2. Who

- Only someone with **Can manage** on the file (`canManageDocument`, the
  Share dialog's own test) makes, changes or turns off its link. Anyone who
  can open the file sees the link and can copy it.
- Owners and Admins (`settings.manage`) have a workspace switch,
  `sharing.publicLinks`, in Workspace › People and access. On by default. Off,
  no link opens and none can be made; on again, the links that were live open
  again (Google Workspace's behaviour for external sharing). Turning one link
  off is the answer to a leak; the switch is the answer to a policy.
- Making, changing and turning off a link is in the audit log
  (`document.public_link_*`) and the team Activity feed ("made a public
  link", "turned off the public link").

### 3. Two addresses, one file

| Address                                           | For             | What it is                                                                            |
| ------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------- |
| `/s/<token>`                                      | People          | The file in the app's own viewer for its type, with the text server-rendered below it |
| `/s/<token>.md`                                   | AI agents       | `text/markdown`: the title, where it is from, then the file's text                    |
| `/s/<token>` + `Accept: text/markdown` (not html) | Agents that ask | Same as `.md`                                                                         |

The page's HTML carries the text, so an agent given the plain link still
reads it without JavaScript. The Share dialog has **Copy link** and **Copy
for AI**.

The text is the file itself for Markdown, plain text and code, and otherwise
the current version's indexed text with its headings put back
(`readableMarkdown`, the same reading the website viewer uses).

### 4. What the outside world can reach

`/api/s/<token>/…` is on the middleware's public list. The routes take only
the token; none accepts a document id, file id or URL from the caller:

| Route                                           | Gives                                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `/`                                             | Title, how to view it, workspace name, URLs under the token                                 |
| `/content`                                      | The current bytes, ranged; `?download=1` only when allowed                                  |
| `/text`, `/markdown`                            | The text (JSON for viewers, Markdown for agents)                                            |
| `/media`, `/media/content`, `/media/transcript` | A recording's transcript or a transcript's recording, only from the same folder             |
| `/mindmap`                                      | The published revision of a mindmap                                                         |
| `/website-preview`                              | A saved page's stored picture; never takes a new one (that runs Chromium for the workspace) |

Left out on purpose: the folder path, document and file ids, who added it,
storage URLs, and every `ocrMetadata` field a viewer does not need to pick
its renderer (a Claude Code session's project path and branch, an artifact's
source link, OCR details). Transcript translation is off: it spends the
workspace's model budget, which an anonymous reader must never do.

Every response is `Cache-Control: private, no-store` (turning a link off works
on the next request), `X-Robots-Tag: noindex`, and `Referrer-Policy:
no-referrer` (the link never leaks through a Referer when the file links
out). Stored bytes keep `storedFileHeaders`, so an uploaded HTML or SVG file
is sandboxed. Each IP has its own budget per route (300 reads, 1,200 byte
requests per 15 minutes).

## Consequences

- One migration, `document_public_links`.
- The media route's recording/transcript pairing moved to
  `server/media-preview.ts`, shared by the workspace route and the public one.
- Viewers read their endpoints from a context (`lib/viewer-endpoints.tsx`)
  instead of building `/api/documents/<id>/…` themselves, so the same viewers
  render a public link.
- The public page draws its viewer in the browser, after hydration; the
  server's HTML carries the words. A PDF opens in the workspace's pdf.js
  reader (it pages on phones, and offers Download only when allowed), without
  notes, highlights or Ask.
- No product analytics on `/s/…`: the address is the secret, and the visitor
  is not a member who could have opted out.
- A link is as strong as its secrecy: anyone it is forwarded to can open it.
  That is the product (Drive's "anyone with the link"); the dialog says so.
- Not in this change:
  - Links to folders or chats
  - Password-protected links, or links limited to an email domain
  - View counts
  - An MCP tool that makes a link
