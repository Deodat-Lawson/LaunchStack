import { and, eq, sql } from "drizzle-orm";

import { db } from "~/server/db";
import { uploadBatches, uploadBatchFiles } from "~/server/db/schema";

export type BatchStatus = "created" | "uploading" | "committed" | "processing" | "complete" | "failed";
export type BatchFileStatus = "queued" | "uploaded" | "processing" | "complete" | "failed";

export type UploadBatchRecord = typeof uploadBatches.$inferSelect;
export type UploadBatchFileRecord = typeof uploadBatchFiles.$inferSelect;

export interface UploadBatchWithFiles extends UploadBatchRecord {
  files: UploadBatchFileRecord[];
}

export interface CreateUploadBatchFileInput {
  filename: string;
  relativePath?: string | null;
  mimeType?: string | null;
  size?: number | bigint | null;
  metadata?: Record<string, unknown> | null;
}

export interface CreateUploadBatchInput {
  userId: string;
  companyId: bigint;
  metadata?: Record<string, unknown> | null;
  files: CreateUploadBatchFileInput[];
}

export interface CreateUploadBatchResult {
  batch: UploadBatchRecord;
  files: UploadBatchFileRecord[];
}

export function generateUploadBatchId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `batch_${ts}_${rand}`;
}

export async function createUploadBatch(input: CreateUploadBatchInput): Promise<CreateUploadBatchResult> {
  const batchId = generateUploadBatchId();

  return db.transaction(async (tx) => {
    const [batch] = await tx
      .insert(uploadBatches)
      .values({
        id: batchId,
        companyId: input.companyId,
        createdByUserId: input.userId,
        status: "created",
        metadata: input.metadata ?? null,
        totalFiles: input.files.length,
        uploadedFiles: 0,
        processedFiles: 0,
        failedFiles: 0,
      })
      .returning();

    if (!batch) {
      throw new Error("Failed to insert upload batch");
    }

    let insertedFiles: UploadBatchFileRecord[] = [];
    if (input.files.length > 0) {
      const fileRows: typeof uploadBatchFiles.$inferInsert[] = input.files.map((file) => ({
        batchId,
        companyId: input.companyId,
        userId: input.userId,
        filename: file.filename,
        relativePath: file.relativePath ?? null,
        mimeType: file.mimeType ?? null,
        fileSizeBytes: toFileSizeBigint(file.size),
        status: "queued",
        metadata: file.metadata ?? null,
      }));

      insertedFiles = await tx.insert(uploadBatchFiles).values(fileRows).returning();
    }

    return { batch, files: insertedFiles };
  });
}

export function toFileSizeBigint(size?: number | bigint | null): bigint | null {
  if (size === undefined || size === null) {
    return null;
  }
  if (typeof size === "bigint") {
    return size;
  }
  if (Number.isNaN(size)) {
    return null;
  }
  return BigInt(Math.max(0, Math.trunc(size)));
}

export async function findBatchOwnedByUser(
  batchId: string,
  userId: string,
  withFiles: true
): Promise<UploadBatchWithFiles | null>;
export async function findBatchOwnedByUser(
  batchId: string,
  userId: string,
  withFiles?: false
): Promise<UploadBatchRecord | null>;
export async function findBatchOwnedByUser(
  batchId: string,
  userId: string,
  withFiles = false
): Promise<UploadBatchRecord | UploadBatchWithFiles | null> {
  if (withFiles) {
    return db.query.uploadBatches.findFirst({
      where: (table, { eq: eqFn, and: andFn }) => andFn(eqFn(table.id, batchId), eqFn(table.createdByUserId, userId)),
      with: { files: true },
    }) as Promise<UploadBatchWithFiles | null>;
  }

  const [batch] = await db
    .select()
    .from(uploadBatches)
    .where(and(eq(uploadBatches.id, batchId), eq(uploadBatches.createdByUserId, userId)));

  return batch ?? null;
}

export async function getBatchWithFiles(batchId: string): Promise<UploadBatchWithFiles | null> {
  const batch = await db.query.uploadBatches.findFirst({
    where: (table, { eq: eqFn }) => eqFn(table.id, batchId),
    with: { files: true },
  });

  return (batch as UploadBatchWithFiles | null) ?? null;
}

export async function refreshBatchAggregates(batchId: string): Promise<void> {
  const [counts] = await db
    .select({
      uploaded: sql<number>`count(*) FILTER (WHERE status <> 'queued')`,
      processed: sql<number>`count(*) FILTER (WHERE status = 'complete')`,
      failed: sql<number>`count(*) FILTER (WHERE status = 'failed')`,
    })
    .from(uploadBatchFiles)
    .where(eq(uploadBatchFiles.batchId, batchId));

  await db
    .update(uploadBatches)
    .set({
      uploadedFiles: counts?.uploaded ?? 0,
      processedFiles: counts?.processed ?? 0,
      failedFiles: counts?.failed ?? 0,
    })
    .where(eq(uploadBatches.id, batchId));
}

export async function updateBatchStatus(
  batchId: string,
  status: BatchStatus,
  extra?: Partial<
    Pick<UploadBatchRecord, "committedAt" | "processingStartedAt" | "completedAt" | "failedAt" | "errorMessage">
  >
): Promise<void> {
  const updateData: Partial<typeof uploadBatches.$inferInsert> = { status };

  if (extra) {
    if (extra.committedAt !== undefined) updateData.committedAt = extra.committedAt;
    if (extra.processingStartedAt !== undefined) updateData.processingStartedAt = extra.processingStartedAt;
    if (extra.completedAt !== undefined) updateData.completedAt = extra.completedAt;
    if (extra.failedAt !== undefined) updateData.failedAt = extra.failedAt;
    if (extra.errorMessage !== undefined) updateData.errorMessage = extra.errorMessage;
  }

  await db.update(uploadBatches).set(updateData).where(eq(uploadBatches.id, batchId));
}

export interface UploadBatchDTO extends Omit<UploadBatchRecord, "companyId"> {
  companyId: number;
  files: UploadBatchFileDTO[];
}

export interface UploadBatchFileDTO
  extends Omit<UploadBatchFileRecord, "companyId" | "fileSizeBytes" | "documentId"> {
  companyId: number;
  fileSizeBytes: number | null;
  documentId: number | null;
}

export function serializeBatch(batch: UploadBatchWithFiles): UploadBatchDTO {
  return {
    ...batch,
    companyId: Number(batch.companyId),
    files: batch.files.map((file) => ({
      ...file,
      companyId: Number(file.companyId),
      fileSizeBytes: file.fileSizeBytes === null ? null : Number(file.fileSizeBytes),
      documentId: file.documentId === null ? null : Number(file.documentId),
    })),
  };
}
