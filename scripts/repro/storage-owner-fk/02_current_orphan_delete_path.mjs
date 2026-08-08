#!/usr/bin/env node
/**
 * Static reproduction of today's P0 orphan path (GitHub #313 / LAU-20).
 *
 * Proves, from source, that full-document delete never touches storage and that
 * upload registration does not persist provider-owned object identity — which
 * is why the storage_objects ownership schema (and the polymorphic-vs-exclusive
 * FK question) exists at all.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const checks = [];

function assert(name, condition, detail) {
  checks.push({ name, ok: Boolean(condition), detail });
}

const deleteRoute = read("apps/web/src/app/api/deleteDocument/route.ts");
const deleteCore = read("apps/web/src/server/services/document-delete.ts");
const batchDelete = read("apps/web/src/app/api/documents/batchDelete/route.ts");
const storageLib = read("apps/web/src/lib/storage.ts");
const uploadRoute = read("apps/web/src/app/api/uploadDocument/route.ts");
const documentSchema = read("packages/core/src/db/schema/base.ts");

assert(
  "deleteDocument route has no storage import",
  !/deleteFile|StoragePort|storage\//.test(deleteRoute),
  "DELETE /api/deleteDocument only performs SQL deletes",
);

assert(
  "deleteDocumentCore has no storage import",
  !/deleteFile|StoragePort|storage\//.test(deleteCore),
  "shared helper is ordered tx.delete(...) only",
);

assert(
  "batchDelete reuses DB-only core",
  /deleteDocumentCore/.test(batchDelete) && !/deleteFileByUrl/.test(batchDelete),
  "batch path can orphan up to 100 docs of objects at once",
);

assert(
  "deleteFileByUrl early-returns for /api/files/",
  /if \(url\.startsWith\("\/api\/files\/"\)\) return;/.test(storageLib),
  "database-backed canonical URLs never delete file_uploads rows",
);

assert(
  "deleteFileByUrl strips only S3 endpoint (bucket remains in key)",
  /url\.slice\(s3Endpoint\.replace/.test(storageLib) &&
    /pdr-documents\/documents\/abc-file\.pdf/.test(storageLib),
  "commented example shows Key becoming bucket/key",
);

assert(
  "uploadDocument schema accepts storageProvider/storagePathname",
  /storageProvider/.test(uploadRoute) && /storagePathname/.test(uploadRoute),
  "identity is available at the API boundary",
);

const uploadHandlerUsesProvider =
  /storageProvider/.test(uploadRoute.split("export async function")[1] ?? "") &&
  /createDocument|uploadDocument|storagePathname/.test(
    uploadRoute.split("export async function")[1] ?? "",
  );

// The Zod schema lists the fields, but the destructure/pass-through must not
// forward them into the upload service for this assertion to hold.
const afterSchema = uploadRoute.slice(uploadRoute.indexOf("export async function"));
assert(
  "upload handler does not forward storageProvider into persistence",
  !/storageProvider\s*,/.test(afterSchema.replace(/storageProvider:\s*z[\s\S]*?optional\(\),/, "")),
  "accepted provider identity is dropped before document registration",
);

assert(
  "document / document_versions persist url, not ObjectRef columns",
  /url: varchar\("url"/.test(documentSchema) &&
    !/storage_location_id|object_ref|owner_type/.test(documentSchema),
  "no durable owned manifest in the engine schema today",
);

const failed = checks.filter((c) => !c.ok);
for (const c of checks) {
  console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}`);
  console.log(`       ${c.detail}`);
}

console.log("");
if (failed.length) {
  console.error(`Orphan-path reproduction incomplete: ${failed.length} assertion(s) failed.`);
  process.exit(1);
}

console.log(
  [
    "Reproduced root cause of the ownership-schema question:",
    "  1. Full/batch document delete is SQL-only → storage bytes orphaned.",
    "  2. Object identity is not persisted as an owned manifest row.",
    "  3. LAU-20 therefore adds storage_objects with exclusive owners;",
    "     polymorphic (owner_type, owner_id) cannot enforce that in Postgres",
    "     (see 01_polymorphic_vs_exclusive_fks.sql).",
  ].join("\n"),
);
