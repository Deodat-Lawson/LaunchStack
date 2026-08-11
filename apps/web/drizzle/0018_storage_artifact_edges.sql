-- Storage deletion lifecycle — artifact lineage table.
--
-- Records derivation relationships between storage objects (e.g. a ZIP
-- object and its extracted children, or a document and a generated
-- summary/transcript) so the deletion coordinator can cascade a delete
-- across a whole artifact group.
--
-- One parent per child by design (unique constraint below) — confirmed
-- with the team that no current or planned artifact flow needs a child
-- object to trace back to more than one parent.
--
-- `edge_type` is intentionally unconstrained (no CHECK/enum): the full
-- taxonomy of edge types belongs to the artifact-lineage policy work and
-- isn't finalized yet.
--
-- Safe to re-run: table creation is guarded with IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS "pdr_ai_v2_storage_artifact_edges" (
    "id" serial PRIMARY KEY,
    "parent_object_id" bigint NOT NULL REFERENCES "pdr_ai_v2_storage_objects"("id") ON DELETE CASCADE,
    "child_object_id" bigint NOT NULL REFERENCES "pdr_ai_v2_storage_objects"("id") ON DELETE CASCADE,
    "edge_type" varchar(64) NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One parent per child.
CREATE UNIQUE INDEX IF NOT EXISTS "storage_artifact_edges_parent_child_unique"
    ON "pdr_ai_v2_storage_artifact_edges" ("parent_object_id", "child_object_id");

CREATE INDEX IF NOT EXISTS "storage_artifact_edges_parent_object_id_idx"
    ON "pdr_ai_v2_storage_artifact_edges" ("parent_object_id");
CREATE INDEX IF NOT EXISTS "storage_artifact_edges_child_object_id_idx"
    ON "pdr_ai_v2_storage_artifact_edges" ("child_object_id");
