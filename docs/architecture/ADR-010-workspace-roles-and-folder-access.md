# ADR-010: Workspace Roles and Folder Access

**Status:** Accepted
**Date:** 2026-09-02
**Deciders:** Repository maintainers

## Context

A workspace had one real boundary — the company — and every member saw
every file. Membership roles were `owner | admin | editor`, but `editor`
restricted no read; a legacy global `users.role` (`employer | employee`)
still decided which app area a person landed in and still authorized two
connector routes; `admin` could not be granted by any invite path (a
"Manager" code minted a second owner); shared invite codes had no expiry,
no email binding and no use limit; an existing account could not join a
second workspace; approval was a column on the person, not the membership;
the employee app was a copy of the employer workspace behind a lint
exception; and nothing recorded who changed what.

That is fine for a founding team and disqualifying for a company with a
Finance folder. The design doc (Workspace Roles and File Access,
2026-09-02) argued the model; this ADR records the decisions it made.

## Decision

**Permissions are the atoms; roles are named sets.** Seventeen permission
strings live in `apps/web/src/lib/authz/permissions.ts`. Four built-in
roles — Owner, Admin, Member, Viewer — plus Guest are defined in code, so a
new workspace needs no seeding and "Admin" means the same thing in every
tenant. Custom roles are `workspace_roles` rows; `user_company_memberships.role`
stays one varchar, resolved built-in-first and by `(company, slug)` otherwise.
`editor` is an alias for Member. Routes gate on `ctx.data.can(permission)`;
`isManagementRole` and every read of `users.role` / `users.status` are
lint-banned.

**The unit of access is the folder, and the folder is the engine `category`
row.** `folder_settings` marks a folder restricted (no row means
workspace-visible); `folder_grants` gives a principal — a person, a group,
or a role — a level (`view | edit | manage`). Restricted folders are hidden,
not shown locked. Per-document restriction (`document_settings`,
`document_grants`) is the exception mechanism for one file in a shared
folder. Zero engine migrations: every new table is product-side and points
at engine tables.

**One `DocumentScope` per request, enforced in three places.**
`requireWorkspaceContext()` returns `documentScope()`, lazy and memoised,
with three shapes chosen so the common case costs nothing: `everything`,
`except` (deny-lists bounded by the number of restricted things), `only`
(allow-lists, for Guests). Anyone holding `folders.manage` sees everything.
The scope is applied as SQL on every `document` read
(`scopedDocumentWhere`) and re-checked by a post-retrieval gate that drops
any chunk outside scope and increments `authz_retrieval_dropped_total`,
which must read zero forever.

**There is no company-wide search.** A search is always over a set of
document ids; "everything" is the set of ids in the caller's scope. The
`company` and `archive` search scopes are deprecated aliases that resolve to
that set and run the same multi-document retrieval path `selected` uses, so
the brick never learns who is asking. The brick's company-scoped functions
keep an optional scope filter for non-user callers (pipelines) and are marked
deprecated. The owner/admin gate on company-wide search is deleted.

**Membership status replaces the global account status.**
`user_company_memberships.status` is `pending | active | suspended`, per
workspace. Email invitations (`workspace_invitations`, SHA-256 token hash,
seven-day expiry, email must match at accept) are pre-approval; join links
(`invite_codes` with expiry and use limits) land per the workspace's
`join_policy`. Existing accounts can join further workspaces. A link never
mints an owner.

**Escalation rules** are pure functions (`lib/authz/escalation.ts`): assign
only permissions you hold; owner-only permissions never enter a custom role;
only an Owner makes or unmakes an Owner, while an Admin may make other
Admins and anything below (a manager can add managers); the last Owner
cannot be removed, suspended or downgraded; nobody changes their own role.

**An append-only audit log** (`workspace_audit_events`) is written inside
the same transaction as every change to membership, invitations, links,
groups, roles, folder visibility, grants, connectors and settings, and on
document deletion. Reading needs `audit.view`.

**One app.** The middleware routes on membership status, not on a URL
prefix; `/employee/**` redirects to its `/employer` twin and the employee
area is deleted. The management surface is a "People and access" section of
the Settings hub; "Manage your team" redirects into it.

## Alternatives rejected

- **Better Auth's `organization` plugin** — duplicates memberships in auth
  tables, moves the boundary the Better Auth migration kept identity-only,
  and has no folder model.
- **Per-document ACL rows as the primary mechanism** — every upload becomes an
  access decision and the retrieval filter grows with the corpus.
- **Postgres row-level security** — the engine client is a shared pool, the
  worker runs without a user, and policies would have to survive a parity
  gate that diffs `pg_dump`.
- **A relationship-based authorization service** — a tenth container for
  relations two levels deep.

## Consequences

- Data moves by `db:backfill` (`2026-09-workspace-access`), never by
  migration: membership status from the legacy account status, `editor →
  member`, join-link roles onto the new vocabulary. The app reads through the
  legacy values, so deploy order cannot lock anyone out or let anyone in.
- `users.role`, `users.status`, `company.employerpasskey` and
  `company.employeepasskey` are no longer read or written and are dropped
  after one release ships with zero reads.
- `@launchstack/retrieval` gains `category` on `ChunkRow` and an optional
  `DocumentScope` on its (deprecated) company-scoped functions; a self-hoster
  embedding the engine sees a filter parameter and nothing else.
- The worst failure the model can produce — the assistant quoting a document
  the asker cannot open — is guarded by the post-retrieval gate, its counter,
  and the red-team retrieval test in CI.
