# Technical Design

**Feature** Nested folders, and folders you can actually rename and delete ·
**Author** Deodat-Lawson (drafted with Claude Code) · **Date** 2026-09-02 ·
**Status** Draft · **Brief** _none — a direct product request; see §9_

---

## 1 Summary

Three complaints about the workspace's folders, one cause. Folders could not be
deleted; a file upload landed in a folder nobody chose and nobody could rename;
and folders could not hold folders. Underneath: a folder was only ever a string
on `document.category`. A `category` row existed for folders created through
"New folder" and for nothing else, so the folder an upload produced had no row
to rename or delete, and deleting a folder that did have one changed nothing —
its documents kept the name and the folder reappeared on the next read.

This design keeps the string and gives it structure. **A folder is a path** —
`Contracts/2026/Globex` — stored verbatim in `document.category` and in
`category.name`. Nesting is a property of the value, so no column changes and
every existing reader of `document.category` keeps working. Rename, move and
delete become prefix rewrites over both tables in one transaction, addressed by
path rather than by row, so a folder that exists only through its documents is
as editable as one that was created empty. Deleting a folder moves what was
inside it up one level; nothing is ever deleted but the folder.

**Ship target** One PR; no migration.

---

## 2 Context and constraints

**Builds on**

- `document.category` (varchar 256, not null) and the `category` table
  (`name`, `companyId`), both in `@launchstack/store`.
- `SourceRail`, `sourceContextMenu`, `useWorkspaceData`, `AddSourceModal`'s
  folder picker, `WorkspaceShell`'s folder handlers.
- `PATCH /api/documents/[id]` (moves one document), the `Categories/*` routes
  (kept for the legacy `/employer/upload` page).
- The kit `Dialog`, `Input`, `Label`, `Button`; lucide icons.

**Not changing**

- The schema. Paths fit the existing columns; a parent-id model is the
  alternative in §5.
- Who may shape the library: creating, renaming, moving and deleting folders
  stays management-only, as the `Categories` routes had it. Reading the tree
  is open to every member (it was management-only, which hid empty folders
  from employees).
- Uploads, connectors, Mindmap publish and every other writer of
  `document.category`. They write a leaf path; the default for "no folder"
  changes from `Uncategorized` to `Unfiled`, the name the UI already used.

---

## 3 Architecture / Design

### 3.1 The path model — `~/lib/folders/path.ts`

Pure and shared. `normalizeFolderPath` (trim, collapse, empty → `Unfiled`),
`folderParentPath` / `folderLeafName` / `folderAncestors`,
`isFolderOrDescendant`, `replaceFolderPrefix`, `validateFolderName` (no `/`,
≤ 80 chars) and `validateFolderPath` (≤ 8 deep, ≤ 256 chars, `Unfiled` reserved
and never a parent), `expandFolderPaths` (every ancestor implied, sorted with
`Unfiled` last), and `buildFolderTree`, which turns paths plus items into the
tree the rail draws — optionally scoped to one folder's subtree, optionally
pruned to folders with matches.

### 3.2 The server module — `~/server/folders`

| Operation                | What it does                                                                                                                                                      | Refuses when                                                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `listFolders`            | `category` rows ∪ distinct `document.category` ∪ implied ancestors, with direct document counts                                                                   | —                                                                                                                           |
| `createFolder(path)`     | inserts a row for the path and each missing ancestor                                                                                                              | invalid path                                                                                                                |
| `renameFolder(from, to)` | one transaction: ensure `to`'s ancestors, rewrite the prefix on `category.name` and `document.category` for the subtree (`= from OR LIKE 'from/%'`, LIKE-escaped) | `from` is Unfiled; `to` invalid; `to` inside `from`; `to` already exists (409 — never a silent merge); `from` unknown (404) |
| `deleteFolder(path)`     | one transaction: documents in the subtree → parent (or Unfiled), then delete the subtree's rows                                                                   | Unfiled; unknown                                                                                                            |

Moving a folder is `renameFolder` with a new parent. A rename of a folder that
had no row gets one, so the name survives its documents moving out later.

### 3.3 The route — `/api/folders`

`GET` (any member) · `POST { path }` · `PATCH { path, newPath }` ·
`DELETE { path }` (management). Bodies carry paths because a derived folder has
no id. Expected outcomes carry their own status through `handleRouteError`;
everything else is a logged 500 with a generic message.

### 3.4 The client

- `useWorkspaceData` reads `/api/folders`, unions the paths with the
  documents' own, expands ancestors, and keeps `WorkspaceFolder.name` as the
  path — the identity every existing consumer already used.
- `SourceRail` draws `buildFolderTree`: subfolders indented under their parent,
  a subtree count on each header, collapse per path. A folder row is draggable
  onto another folder (not itself, its subtree, or Unfiled) and empty rail space
  is the top level. The row's hover button and right-click open one menu: Open
  folder (scope the rail to the subtree), New subfolder…, Rename…, Move to…,
  Select all, Delete…. Unfiled offers only Open and Select all.
- `FolderDialog` (create under a parent, or rename in place) and
  `DeleteFolderDialog` (real counts, where things go) replace the two
  hand-rolled dialogs, on the kit `Dialog`.
- `WorkspaceShell` gates every folder mutation on `isManagementRole(role)`,
  calls `/api/folders`, keeps the scope chip pointing at a renamed folder, and
  defaults uploads to the folder the rail is scoped to, else Unfiled.
- The add-source picker shows the tree and accepts `A/B` to create nested.

---

## 4 Impacts

**Graph changes** None. **Provider interfaces** None. **Background jobs** None.

**Public surface** New `/api/folders` (four verbs). `Categories/*` routes are
unchanged and still serve the legacy upload page; they see paths as names.
`PATCH /api/documents/[id]` normalizes `category` to a path. The upload
default becomes `Unfiled`.

**Existing data** A workspace whose documents sit in `Uncategorized` sees an
`Uncategorized` folder it can now rename, move, or delete. A category name that
already contains `/` is read as nested — none was found locally, and the
result is a folder tree rather than an error.

---

## 5 Alternatives considered

| Option                                            | Why it was rejected                                                                                                                                                                                                                                                                                   | What would change our mind                                                                                                                                                          |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`category.parent_id` + `document.category_id`** | The right long-term model, but it is a migration, a backfill across every company, and a change to every writer of `document.category` (uploads, batches, Drive, GitHub, website, Mindmap, notes) and every reader (dashboards, predictive analysis, extraction). Weeks of blast radius for a UI ask. | Folder renames becoming hot enough that a prefix rewrite over documents is measurable, or a need for per-folder metadata (colour, owner, ACL). Paths convert cleanly: split on `/`. |
| **Delete only; no nesting**                       | The user asked for nesting.                                                                                                                                                                                                                                                                           | —                                                                                                                                                                                   |
| **Delete deletes the sources too**                | Folder deletion as a mass-delete of documents is the worst thing a misclick could do. Sources move up instead, and the dialog says so with numbers.                                                                                                                                                   | Never as the default; a separate "delete folder and contents" could be added behind its own confirmation.                                                                           |
| **Merge on rename collision**                     | Silently combining two folders is surprising and irreversible.                                                                                                                                                                                                                                        | An explicit "Merge into…" action.                                                                                                                                                   |

---

## 6 Failure modes

| What breaks                                | Blast radius                                                                        | How we detect it                                                          | Fallback                                                   |
| ------------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **A folder name contains `%`, `_` or `\`** | Without escaping, `LIKE` would match other folders and a rename would rewrite them. | `escapeLikeLiteral` is unit-tested.                                       | —                                                          |
| **Rename target already exists**           | Two folders silently merged.                                                        | Checked before the transaction; 409.                                      | The dialog shows the message; the user picks another name. |
| **Folder moved into its own subtree**      | Every path beneath it rewritten into nonsense.                                      | Checked in the client (drop refused, menu excludes) and the server (400). | —                                                          |
| **Half-applied rename**                    | Documents say one path, the row says another.                                       | Both writes share one transaction.                                        | —                                                          |
| **Deleted folder reappears**               | The original bug.                                                                   | Documents are re-homed before the rows go; the tree is rebuilt from both. | —                                                          |
| **`/api/folders` unreachable**             | Empty folders disappear from the rail; the tree is still derived from documents.    | Console warning.                                                          | Documents' own paths.                                      |
| **A member without a management role**     | Cannot shape folders; the controls are absent, not broken.                          | Server 403 if reached.                                                    | —                                                          |
| **Deep or long paths**                     | A `document.category` over 256 chars would fail the insert.                         | `validateFolderPath` bounds depth (8) and length (256) before any write.  | —                                                          |

**The worst thing this can do to a team** A misdrop moves a top-level folder
with hundreds of sources under another folder. Nothing is lost; the same drag
back, or Move to… → Top level, undoes it.

---

## 7 Verification

**Automated** `__tests__/lib/folders/path.test.ts` (normalization, structure,
prefix rewrite, validation, expansion, tree), `__tests__/server/folders`
(LIKE escaping, error shape), `__tests__/api/folders.route.test.ts` (member
read, role gate, validation, 409 mapping, error hygiene),
`sourceContextMenu.test.ts` (folder menu items, move targets exclude self,
subtree, parent, Unfiled), `SourceRail.tree.test.tsx` (nesting and counts,
delete from the row menu, Unfiled's reduced menu, folder drop, refused drops,
source drop on a nested folder, scoping and "New subfolder"),
`folderDialogs.test.tsx` (create under a parent, taken and slash names, rename
in place, server refusal shown, delete copy and confirm).

**End-to-end dry run** `/dev/source-rail` runs the real rail, menus and dialogs
against in-memory state: create, rename, move by drag, move by menu, delete,
scope. The server module was exercised against the local Postgres with a
script: create → rename → move a document in → delete, verifying the rows and
the document's final `category`.

**The check that catches the worst failure in §6** The folder-drop test pins
that a folder cannot be dropped into its own subtree, and the server refuses
the same move — both layers, because drag-and-drop is where a misfire is most
likely.

---

## 8 Team assignment (after approval)

Single PR.

---

## 9 Open questions

| Question                                                                                                                                                          | Who decides            | By when                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | --------------------------------------- |
| Should members without a management role be able to create folders and file their own uploads? Today the API forbids it, as the old `Categories` routes did.      | Deodat-Lawson          | Before the next employee-facing release |
| Google Drive folders are nested too. Should the Drive connector map a picked folder's subtree onto nested workspace folders instead of one `Google Drive` folder? | Repository maintainers | With the next Drive connector iteration |
| Move to the `parent_id` model? Paths convert cleanly whenever it becomes worth it.                                                                                | Repository maintainers | When per-folder metadata is wanted      |
