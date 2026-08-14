/**
 * Command acceptance for uploads/imports (ADR-003 §2).
 *
 * apps/web resolves identity and storage, then calls these use cases; the
 * lifecycle port persists the source version AND its `source.version.created`
 * outbox event in one transaction. Nothing is dispatched post-commit — the
 * worker discovers the event by polling the outbox.
 */
import { z } from "zod";

import type {
  CreateSourceCommand,
  CreateSourceVersionCommand,
  LoggerPort,
  SourceLifecyclePort,
  SourceLifecycleResult,
} from "../ports";

const actorSchema = z.object({
  actorId: z.string().min(1),
  companyId: z.number().int().positive(),
});

const optionsSchema = z.object({
  forceOCR: z.boolean().optional(),
  preferredProvider: z.string().optional(),
  embeddingIndexKey: z.string().optional(),
  mimeType: z.string().optional(),
  originalFilename: z.string().optional(),
  isWebsite: z.boolean().optional(),
  archiveIdentity: z.string().optional(),
  transcriptionMetadata: z.record(z.unknown()).optional(),
  skipProcessing: z.boolean().optional(),
});

const createSourceSchema = z.object({
  actor: actorSchema,
  documentUrl: z.string().min(1),
  documentName: z.string().min(1),
  category: z.string(),
  creationKey: z.union([z.string().min(1), z.array(z.string()).min(1)]),
  traceId: z.string().min(1),
  options: optionsSchema,
});

const createVersionSchema = z.object({
  actor: actorSchema,
  sourceId: z.number().int().positive(),
  documentUrl: z.string().min(1),
  creationKey: z.union([z.string().min(1), z.array(z.string()).min(1)]),
  changelog: z.string().optional(),
  fileSize: z.number().int().nonnegative().optional(),
  traceId: z.string().min(1),
  options: optionsSchema,
});

export interface AcceptSourceUploadDeps {
  lifecycle: SourceLifecyclePort;
  logger: LoggerPort;
}

export function createAcceptSourceUpload(deps: AcceptSourceUploadDeps) {
  return {
    async acceptSource(
      cmd: CreateSourceCommand,
    ): Promise<SourceLifecycleResult> {
      const parsed = createSourceSchema.parse(cmd);
      const result = await deps.lifecycle.createSource(parsed);
      deps.logger.info(
        {
          traceId: parsed.traceId,
          companyId: parsed.actor.companyId,
          sourceId: result.sourceId,
          sourceVersionId: result.sourceVersionId,
        },
        "source upload accepted",
      );
      return result;
    },

    async acceptSourceVersion(
      cmd: CreateSourceVersionCommand,
    ): Promise<SourceLifecycleResult> {
      const parsed = createVersionSchema.parse(cmd);
      const result = await deps.lifecycle.createSourceVersion(parsed);
      deps.logger.info(
        {
          traceId: parsed.traceId,
          companyId: parsed.actor.companyId,
          sourceId: result.sourceId,
          sourceVersionId: result.sourceVersionId,
          versionNumber: result.versionNumber,
        },
        "source version accepted",
      );
      return result;
    },
  };
}

export type AcceptSourceUpload = ReturnType<typeof createAcceptSourceUpload>;
