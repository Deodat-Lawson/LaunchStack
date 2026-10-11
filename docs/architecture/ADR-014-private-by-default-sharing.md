# ADR-014: Private by Default, Simple Sharing, and the Team Layer

**Status:** Accepted
**Date:** 2026-10-10
**Deciders:** Repository maintainers
**Amends:** ADR-010 (admin read bypass, who may create folders)

## Context

Since ADR-010 everything a person adds is visible to the whole workspace
unless someone opens the Access dialog afterwards, and nothing records an
owner. Chats are the opposite: owner-only, with no way to share one. The
History list mixes your own chats with workspace-wide runs, and nothing on
screen says which is which. People could not tell what was theirs and what
was shared.

How other products answer this (sources in the 2026-10-10 brief):

| Product                   | New item default                        | Folder rule                                                                                                    | Shared conversation                                                                                                                                              |
| ------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google Drive              | Restricted ("only people with access")  | Folder access flows to everything inside; moving a file drops the old folder's access and picks up the new one | n/a                                                                                                                                                              |
| Notion                    | Private section ("only visible to you") | Subpages take the parent page's permissions; can be changed on the subpage                                     | n/a                                                                                                                                                              |
| Box                       | n/a                                     | "Waterfall": access flows down to all content beneath                                                          | n/a                                                                                                                                                              |
| Claude.ai, Copilot, Glean | Chats private                           | n/a                                                                                                            | Read-only snapshot to people or the org; continuing makes a private copy in the reader's history (Copilot); citations the reader can't open are redacted (Glean) |
| Codex app                 | n/a                                     | n/a                                                                                                            | History: Pinned, then Recents by latest activity; pinned items keep a manual order; Archive hides, an Archived view restores                                     |

## Decision

### 1. New things are private to whoever made them; the folder is still the unit of sharing

- A **new top-level folder** is created restricted, with one `manage` grant
  for its creator ("Only you").
- A **new subfolder** has no settings row, so it inherits its parent. Its
  creator still gets a `manage` grant on it, so they can change its access
  later without seeing more than they already do.
- A **new loose file** (no folder, i.e. `Unfiled`) gets a restricted
  `document_settings` row and a `manage` grant for its uploader.
- A **new file in a folder** inherits the folder. The uploader gets a
  `manage` grant on the document (no restriction), so they can share it on
  its own.
- **Moving never widens who can see something by accident.** A folder or
  file leaving the restricted folder it inherited its audience from takes
  that audience with it, as its own. The exception follows Drive: when that
  audience was only the mover and the item is filed into another folder (not
  the top level, not Unfiled), it joins the destination's audience. A file
  with its own audience keeps it, unless that audience is only the mover and
  it is filed into a folder. A file sent to Unfiled with nothing restricting
  it becomes private to the mover. (QA found that, without the carry, an
  editor could publish an owner's files by moving a subfolder out.)
- A folder that springs into being with an API upload (a path that did not
  exist) gets the same defaults as one made by hand.
- Every folder write — `/api/folders` and the legacy `/api/Categories` routes —
  goes through `server/workspace/folder-actions.ts`. Folder names are paths
  shared by the workspace: creating one already held by a folder you can't
  see makes "Name (2)" instead of silently doing nothing.
- Existing files and folders are untouched: what was workspace-wide stays
  workspace-wide.

Members (anyone with `documents.upload`) can create top-level folders. A
subfolder needs edit access to its parent. `folders.manage` is no longer
required to create one.

### 2. Private means private, including from Owners and Admins

`folders.manage` no longer bypasses read scope. Owners and Admins see what
is workspace-wide, what is granted to them, and what is granted to their
role, the same as everyone else. To avoid locking anyone out, the migration
gives the `owner`, `admin` and every custom role holding `folders.manage` a
`manage` grant on every folder and document that was restricted before this
change. The exception is the `Gmail` subtree, which was always meant to be
private.

`folders.manage` now means "may change access on workspace-wide folders".
Changing access on a restricted item requires a `manage` grant that reaches
you on that item or on the folder governing it.

When a member is removed, every restricted folder or document where they
held the only `manage` grant gets a `manage` grant for whoever removed them.
Their chats are not transferred: a conversation stays personal, and
recipients of a shared chat keep reading it.

### 3. Levels mean something

| Level    | Label      | May                                           |
| -------- | ---------- | --------------------------------------------- |
| `view`   | Can view   | open, cite, fork (chats)                      |
| `edit`   | Can edit   | also add files, rename, move, replace, delete |
| `manage` | Can manage | also change who has access                    |

`canEditDocument` enforces this for rename, move and new versions, on top of
the role permission. A grant on the document wins over the folder. Moving
needs edit on the source and edit on the destination folder.

Deleting a file needs manage on it (whoever added it), or edit plus
`documents.delete`. A Member can throw away their own upload, not a
teammate's.

Deleting a folder copies each governing restriction onto the documents it
re-homes, so deleting a restricted folder never publishes its contents.
Deleting a custom role removes its grants.

**Adding someone to something that inherits** — a subfolder or file showing
"Same as Q4 planning" — opens it to them on top of the folder's audience, as in
Drive and Notion. `resolveDocumentScope` turns such reach-in grants into the
same carve-outs a granted restricted subfolder uses (`allowedCategories`,
`allowedDocumentIds`), and only when the item would otherwise be closed to
them, so the scope grows with what was shared into closed places rather than
with everything someone uploaded.

### 4. Chats: private by default, shared as read-only, continued as a fork

- `workspace_session_grants` (`user | group | role | workspace`, level `view`)
  and `workspace_sessions.shared_at`. `resolveSessionAccess(ctx, id)` returns
  `owner | view | null`, and null is a 404.
- A reader sees the transcript live, not a snapshot, because a teammate
  sharing a working chat wants you to see where it went next. Citations are
  filtered to the reader's own scope before they leave the server.
- "Continue in a new chat" calls `POST /api/workspace/sessions/:id/fork`. The
  server copies the messages into a new private chat owned by the reader and
  records `forked_from_session_id`.
- Readers can't send, rename or delete.

### 5. History is organised per person

`workspace_session_user_state(session_id, user_id, pinned_at, pin_rank,
archived_at, last_seen_at)` holds each person's pins, manual pin order,
archive and unread state, for their own chats and for chats shared with them.
The History rail shows:

- **Pinned**, in manual order
- **Shared with you**
- Recents, newest activity first, grouped by date

Archive hides an item, and an Archived view restores it. Runs stay in the
list and can be hidden as before. Deleting a chat asks for confirmation.

### 6. The Sources rail answers "who can see this"

The rail has three sections, as in Notion: **Workspace** (everyone),
**Shared** (specific people, including things shared with you), and
**Private** (only you). Each top-level folder and each loose file sits in the
section its audience puts it in. A subfolder whose access differs from its
parent's stays inside the parent and shows a badge.

### 7. The team layer on the main page

- **Share dialog**: one for folders, files and chats.
  - Add people or groups, and create a group inline.
  - A level per person.
  - **General access**:
    - Only people added
    - Everyone at <workspace>
    - Same as <parent>, when the item is nested
  - An "Added by" line.
- **Team tab** in the rail, with three views:
  - **People**: photo, title, role and groups. Open a person to see what you
    share with each other, share with them, or invite someone.
  - **Groups**: members can create groups. The creator manages their group;
    `groups.manage` manages all groups.
  - **Activity**: who added, shared, moved, renamed or deleted what. Rows come
    from `workspace_activity` and are filtered to what the reader can see now —
    folders by id (a renamed or deleted private folder's old name never
    shows), deleted items only to their actor unless they were workspace-wide.
- **Inbox**: `workspace_notifications`, written in the same transaction as
  the grant. Sharing with a person, or with a group they belong to, notifies
  them. A bell in the rail header shows the unread count.

## Consequences

- One product migration, `private_by_default_sharing`: four new tables, two
  session columns, the admin carry-over grants, and owner pin state copied
  from `workspace_sessions.pinned`, which is kept but no longer read.
- Scope cost grows with restricted items. Private-by-default makes most new
  loose files restricted, and each one adds an id to other people's deny
  list. That is fine at today's sizes (hundreds). If a workspace reaches
  thousands, move the deny list into a SQL subquery.
- Admins who relied on seeing everything now see what is shared with them.
  The carry-over grants keep everything restricted before today visible to
  them.
- Not in this change:
  - Contributing to someone else's chat
  - Public links
  - Email notifications
  - Chat folders or projects
  - A per-viewer "unshare from me"
