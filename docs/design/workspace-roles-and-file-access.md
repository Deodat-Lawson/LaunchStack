# Technical Design

**Feature** Workspace roles and file access · **Author** Deodat-Lawson, with
Claude · **Date** 2026-09-03 (rev 2) · **Status** Implemented on
`claude/crm-role-management-design-50894f`, in review · **Brief** _none — see §9_

> Written without an approved brief, which the template forbids. The kill test
> is argued in §1: a workspace has one real boundary (the company) and every
> member sees every file — fine for a founding team, disqualifying for a company
> with a Finance folder. The full design with diagrams is the review artifact
> "Workspace Roles and File Access" (2026-09-02); this file is the repo copy.
> Decisions are recorded in [ADR-010](../architecture/ADR-010-workspace-roles-and-folder-access.md).
> Revision 2 (2026-09-03) folds in review: one kind of person (no employer /
> employee split), managers may add managers, access per folder with per-file
> exceptions, and no company-wide search — a search is a set of document ids.

---

## 1 Summary

A workspace gains a real access model: four built-in roles (Owner, Admin,
Member, Viewer, plus Guest) defined as sets of named permissions; folders that
are either visible to the whole workspace or restricted to the people, groups,
and roles granted access; email invitations and expiring join links that put
people in the right role on arrival; and an audit log of every change to who can
do what. A three-person startup never touches a setting and behaves exactly as
before; a two-hundred-person company adds groups, custom roles, and
per-document restrictions without anything being rebuilt. Under the hood,
`requireWorkspaceContext()` hands routes two questions instead of a role string
— _can this person do X?_ and _which documents may this person see?_ — and the
second answer is pushed into every SQL read and into the retrieval brick, so the
assistant can only cite what the asker is allowed to open. The legacy global
`users.role` and the duplicate employee app stop being load-bearing.

**Ship target** All four phases are on this branch. Legacy column drops
(`users.role`, `users.status`, the company passkeys) wait one release with zero
reads, per §3.10.

---

## 2 Context and constraints

**Builds on** `requireWorkspaceContext()` and its rule that the role comes
from `user_company_memberships`; the active-workspace cookie; Better Auth as
identity only; the engine `category` table, which already is the folder
(`document.category` is its name and a rename cascades in one transaction); the
`AccessValidator` seam the retrieval brick declared and nobody wired; the
two-ledger migration setup and its DDL-only and parity gates; the Settings hub.

**Not changing** The engine schema — zero engine migrations; every new table is
product-side. Better Auth stays identity-only. Ingestion, OCR, embeddings, the
knowledge graph — no ACL is stored in an index. Storage and the signed
file-token path for the OCR worker. Route URLs. Credits and billing.

**As built before this change**

| Area | As built | Consequence |
|---|---|---|
| Roles | `owner \| admin \| editor` on the membership; global `users.role` (`employer \| employee`) still routed app areas and authorized two connector routes | Two vocabularies, two sources of truth |
| Admin | The only invite path mapped a "Manager" code to `owner` | Admin unreachable; a manager invite minted a second owner |
| Reading files | Every read scoped by `companyId` only | No way to have a folder only Finance can see |
| Search | Company-wide search owner/admin only, but `selected` scope accepted any id in the company | The gate restricted a strategy, not a corpus |
| Retrieval | `getCompanyChunks(companyId)` had no user dimension | A per-user restriction would be invisible to the assistant |
| Joining | Shared codes, no expiry, no email binding; existing accounts could not join a second workspace | Offboarding a code offboards everyone who has it |
| Approval | `users.status` on the person | Per account, not per workspace; no suspend |
| Employee app | Rendered the employer shell through a lint exception | Every feature shipped twice |
| Audit | None | No answer to "who gave the contractor access to Legal?" |

---

## 3 Architecture / Design

**In one sentence.** Permissions are the atoms; a role is a named set; a folder
is workspace-visible or restricted; a grant gives a principal (person, group,
role) a level on a restricted folder or document; every request resolves a
permission set and a document scope once, and everything downstream consumes
them.

### 3.1 Permissions and built-in roles

`apps/web/src/lib/authz/permissions.ts` holds seventeen permission strings and
five built-in roles, in code. Owner holds everything; Admin everything but
`billing.manage` and `workspace.transfer`; Member reads, uploads, edits, and
sees the member list; Viewer reads; Guest reads only folders explicitly granted.
`editor` is an alias for Member (nothing is taken away; rename/move inside
editable folders is added). Custom roles are `workspace_roles` rows;
`user_company_memberships.role` stays one varchar, resolved built-in-first.
`isManagementRole` and every read of `users.role` / `users.status` are
lint-banned; the 37 call sites moved to `ctx.data.can(permission)`.

### 3.2 Membership state, invitations, join links

`user_company_memberships.status` is `pending | active | suspended`, per
workspace. `workspace_invitations` stores the email, role, group ids, a SHA-256
of a 32-byte token, and a seven-day expiry; the email goes through
`sendAuthEmail` and the UI always shows the same link. Accepting requires a
session whose email matches and creates an `active` membership in one
transaction with its audit row. `invite_codes` gain `expires_at`, `max_uses`,
`use_count`; a link never mints an owner; where a link arrival lands is
`workspace_settings.join_policy` (`approval` by default).

### 3.3 Folders, visibility, grants

The folder is the engine `category` row. `folder_settings` marks a folder
restricted (no row = workspace-visible); `folder_grants` gives a principal a
level (`view | edit | manage`) that composes with — never exceeds — the role.
Restricted folders are hidden, not locked. Documents whose category has no
folder row are workspace-visible; connectors create their folder row on first
sync. `document_settings` / `document_grants` are the exception mechanism for
one file in a shared folder.

### 3.4 Groups and custom roles

`workspace_groups` / `workspace_group_members` make a group a principal.
`workspace_roles` holds `(company_id, slug, name, permissions text[])`.
Built-ins cannot be edited or deleted.

### 3.5 Resolution at request time

`ctx.data.can()` is synchronous over the resolved set. `ctx.data.documentScope()`
is lazy and memoised; it reads the restricted folders and documents, the
caller's groups, and the grants that reach them, and returns one of
`everything`, `except { deniedCategories, deniedDocumentIds, allowedDocumentIds }`,
or `only { allowedCategories, deniedDocumentIds, allowedDocumentIds }`. Anyone
with `folders.manage` sees everything. It is enforced in three places:

- **Scoped SQL** — `scopedDocumentWhere(companyId, scope)` on every `document`
  read; out-of-scope single reads 404, indistinguishable from missing.
- **Search is a set of ids** — there is no company-wide search. The
  `company` and `archive` scopes are deprecated aliases for "every id in my
  scope"; every question runs the same multi-document retrieval path over a
  list of readable ids, so `@launchstack/retrieval` never learns who is asking
  (`ChunkRow` gains `category`; the brick's company functions keep an optional
  scope filter for pipelines and are deprecated).
- **The post-retrieval gate** — every chunk from every leg passes
  `scopeAllowsDocument` before it enters a prompt; drops increment
  `authz_retrieval_dropped_total`, which must read zero forever.

The owner/admin gate on company-wide search is deleted.

### 3.6 Escalation rules

Assign only permissions you hold; owner-only permissions never enter a custom
role; only an Owner makes or unmakes an Owner, while an Admin may make other
Admins and anything below (a manager can add managers); the last Owner cannot be
removed, suspended, or downgraded; nobody changes their own role.

### 3.7 Audit log

`workspace_audit_events` is append-only and written inside the same
transaction as the change. Actions are a closed vocabulary. Reading needs
`audit.view`; retention is a setting.

### 3.8 The user interface

"People and access" is a section of the Settings hub (Members, Invitations and
join links, Groups, Roles, Audit, workspace settings); "Manage your team"
redirects into it. "Share folder…" on the folder rail and "Restrict access…" on
a document open one dialog: visibility, a principal picker, a level per row, a
live audience line. `usePermissions()` fails closed while loading. The
middleware routes on membership status; `/employee/**` redirects to its
`/employer` twin and the employee area is deleted.

### 3.9 Data model

All new tables are product-side (`apps/web/src/server/db/schema/access.ts`)
and point at engine tables. Migration `20260903024746_workspace_access`
(product ledger) adds them and appends `status`/`updated_at` to memberships and
`expires_at`/`max_uses`/`use_count` to join links.

### 3.10 Migration and backfill

DDL ships as a product-ledger migration. Data moves in `db:backfill
--only=2026-09-workspace-access`: membership status from the legacy account
status, `editor → member`, join-link roles onto the new vocabulary. The app
reads through legacy values (`editor` stays an alias), so deploy order cannot
lock anyone out or let anyone in. `users.role`, `users.status`, and the company
passkeys are no longer read or written and are dropped after one release ships
with zero reads.

---

## 4 Impacts

**Graph changes** None. The graph retriever's chunks pass through the
post-retrieval gate like every other leg.

**Provider interfaces touched** None of LLMProvider / StorageProvider /
AuthProvider. The permission model sits on the product side of the OSS
boundary; the engine gains only an optional `DocumentScope` on the retrieval
brick.

**Public surface** New: `/api/workspace/{members, invitations, join-links,
groups, roles, folders/[id]/access, documents/[id]/access, principals, audit,
settings, transfer-ownership}` and the `/invite/[token]` page. Changed:
`fetchDocument` returns only readable documents (with `restricted`);
`GetCategories` answers every member with visible folders (with `restricted`);
`fetchUserInfo` adds `permissions` and `membershipStatus`; `AIChat/query`
accepts every scope from any member; `signup/join` accepts existing accounts.
Removed: `getAllEmployees`, `approveEmployees`, `removeEmployees`,
`employeeAuth`, `employerAuth`, `invite-codes/*`, the passkey signup routes, the
`/employee/**` area.

**External services, and how they fail** None new. Invitation email rides the
console adapter on a self-hosted instance without a mail provider; the UI
always shows the link, so the feature degrades to a copy-paste.

**Background jobs** None required. Expiry and use limits are checked at accept
time; every change is one transaction with its audit row. The backfill runs
once by hand.

---

## 5 Alternatives considered

| Option | Why it was rejected | What would change our mind |
|---|---|---|
| Better Auth `organization` plugin | Duplicates memberships in auth tables; no folder model | An auth consolidation that retires `users`/`company` |
| Per-document ACL rows as the primary mechanism | Every upload becomes an access decision; the retrieval filter grows with the corpus | Documents ceasing to have a folder |
| Postgres row-level security | Shared pool, worker without a user, policies in two ledgers under a `pg_dump` parity gate | A second DB consumer reading under user scope |
| OpenFGA / SpiceDB | A tenth container for two-level relations | Cross-workspace sharing or deep nesting |
| Do nothing | Every member keeps seeing every file; Admin unreachable; shared codes the only way in | Deciding LaunchStack is a founding-team tool |

---

## 6 Failure modes

| What breaks | Blast radius | How we detect it | Fallback |
|---|---|---|---|
| Venue network blocks outbound calls | N/A — authorization is in-cluster Postgres; only invitation email leaves, and the on-screen link covers it | — | — |
| Event page or rules change format mid-event | N/A — nothing external is parsed | — | — |
| Repo is private, enormous, or barely committed | N/A — nearest analog (thousands of documents, many restricted folders) is bounded: the scope is sized by restricted folders, never documents | `authz_scope_size` | — |
| Upload fails, or the video lands private | Reframed: a document lands in the wrong folder and is visible to the wrong people until moved | Upload audit carries the folder; the upload UI states the audience | Move it; `document_views` says who opened it |
| A new read route forgets the scope helper | Restricted documents readable through that route | Permission-gate and scope tests; lint bans bare company-only document selects | Bounded to restricted folders |
| A retrieval leg bypasses scope | The assistant cites a document the asker cannot open | Post-retrieval gate drops it; `authz_retrieval_dropped_total` > 0 pages | The gate itself |
| The last Owner is removed or downgraded | A workspace nobody can administer | Refused at the write | Repair script promotes the earliest Admin |
| A custom role escalates itself | An Admin builds a role holding `billing.manage` | Prevented: assignable ⊆ actor's; owner-only never assignable | Audit names the actor |
| An invitation link leaks | Someone joins as the invited role | Single-use, seven-day, email must match | Suspend and revoke |
| Backfill runs after the deploy | Memberships still on defaults while `users.status` says pending | Read-through for one release; `db:backfill --list` | Re-run; idempotent |
| A group is deleted | Everyone whose only grant came through it loses access — fail closed | The dialog says how many lose access; audit | Re-create from the audit trail |
| The client shows a control the server refuses | A confusing 403, never a leak | `authz_denied_total` | `usePermissions()` fails closed |

**The worst thing this can do to a team** — A Member asks the assistant a
question and the answer quotes the board deck from a restricted Leadership
folder they were never allowed to open, and nobody finds out because the answer
looks like every other answer. The post-retrieval gate, its counter, and §7's
red-team test exist for this.

---

## 7 Verification

**Automated** Unit tests on the catalogue, resolver, escalation rules, scope
shapes and SQL (`apps/web/__tests__/authz/*`); the scope resolver against a
migrated throwaway Postgres (`scope-resolve.integration.test.ts`, gated on
`LAUNCHSTACK_TEST_DATABASE_URL`); route tests per permission gate and per scoped
read; retrieval-brick tests for scope → SQL; the retrieval gate test; the
existing migration gates (schema-drift, DDL-only, migrations-apply).

**End-to-end dry run** Against the local Docker backend: create a workspace as
Owner; invite by email, take the link from the server log, accept as a new
account; restrict a Finance folder and upload a sentinel document into it; as
the Member confirm the folder, the document, its content route, and a
company-wide question all stay silent; grant `view` and watch them appear;
suspend and watch every request 403; read the audit tab.

**The check that catches the worst failure in §6** The red-team retrieval
test: one restricted document with a sentinel phrase, one Member without a
grant, every search scope with every leg on; the sentinel never appears and the
dropped counter reads zero.

**Instrumentation** `authz_denied_total{permission,route}`,
`authz_scope_size{kind}`, `authz_retrieval_dropped_total{scope}` on
`/api/metrics`; audit events per action; the invitation funnel.

---

## 8 Team assignment (after approval)

| Part | Owner |
|---|---|
| Catalogue, resolver, context, call-site migration, lint ratchet | done on branch |
| Membership status, invitations, join links, backfill | done on branch |
| Audit table and writers | done on branch |
| DocumentScope, scoped reads, retrieval port, post-retrieval gate | done on branch |
| People and access, Share folder, invite page, employee-area removal | done on branch |
| Groups, custom roles, per-document restriction, Guest | done on branch |
| Legacy column drops | next release |

---

## 9 Open questions

| Question | Who decides | By when |
|---|---|---|
| No approved brief — does §1 count as the kill test? | Repository maintainers | At review |
| Restricted folders hidden entirely (as built) vs shown locked | Product | Before merge |
| Viewer may download what it can read (as built); acceptable? | Product | Before merge |
| Rename `/employer/**` to `/workspace/**`? | Repository maintainers | Next release |
| Auto-switch the active workspace on invitation accept (as built: yes) | Product | Before merge |
| SCIM / importing Drive sharing as grants — which first? | Repository maintainers | When asked |
| Default audit retention on self-host (as built: unlimited) | Repository maintainers | Before merge |
| Cross-request scope cache — needed? Decide on measured `authz_scope_size` | Implementer | After first mid-size workspace |
