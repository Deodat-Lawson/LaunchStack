/**
 * Emits JSON Schemas for every cross-language contract into `schemas/v1/`.
 *
 * Contracts live inside their features (@launchstack/conversion,
 * @launchstack/orchestration, @launchstack/editing); this generator walks
 * them and emits the one bundle the Python services test against.
 *
 * The Python services (`services/transcription`,
 * `services/adeu-ai-docs-editing`, `services/document-converter` consumers)
 * validate their pydantic models against these files in their contract tests, so a drift
 * between the zod source and the generated output is a contract break.
 *
 * Usage:
 *   pnpm schemas:generate           # (re)write schemas/v1/*.schema.json
 *   pnpm schemas:check              # fail if the files would change (CI)
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { z } from "zod";

import {
    convertRequestSchema,
    evidenceDocumentSchema,
    renderPagesRequestSchema,
    renderPagesResponseSchema,
    routeRequestSchema,
    routeResponseSchema,
    serviceErrorSchema,
    transcribeResponseSchema,
    videoTranscribeRequestSchema,
    videoTranscribeResponseSchema,
} from "@launchstack/conversion";
import { pipelineEventSchema } from "@launchstack/orchestration/pipeline-events";
import {
    applyEditsMarkdownRequestSchema,
    applyEditsMarkdownResponseSchema,
    batchResultSchema,
    batchSummarySchema,
    diffResponseSchema,
    documentEditSchema,
    editorErrorResponseSchema,
    processBatchRequestSchema,
    readDocxResponseSchema,
    reviewItemSchema,
    reviewItemsResponseSchema,
} from "@launchstack/editing/wire";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "schemas", "v1");

const CONTRACTS: Record<string, z.ZodType<unknown>> = {
    "pipeline-event": pipelineEventSchema,
    "evidence-document": evidenceDocumentSchema,
    "service-error": serviceErrorSchema,
    "converter.route-request": routeRequestSchema,
    "converter.route-response": routeResponseSchema,
    "converter.render-pages-request": renderPagesRequestSchema,
    "converter.render-pages-response": renderPagesResponseSchema,
    "converter.convert-request": convertRequestSchema,
    "transcription.transcribe-response": transcribeResponseSchema,
    "transcription.video-request": videoTranscribeRequestSchema,
    "transcription.video-response": videoTranscribeResponseSchema,
    "document-editor.document-edit": documentEditSchema,
    "document-editor.read-docx-response": readDocxResponseSchema,
    "document-editor.process-batch-request": processBatchRequestSchema,
    "document-editor.batch-summary": batchSummarySchema,
    "document-editor.batch-result": batchResultSchema,
    "document-editor.review-item": reviewItemSchema,
    "document-editor.review-items-response": reviewItemsResponseSchema,
    "document-editor.apply-edits-markdown-request": applyEditsMarkdownRequestSchema,
    "document-editor.apply-edits-markdown-response": applyEditsMarkdownResponseSchema,
    "document-editor.diff-response": diffResponseSchema,
    "document-editor.error-response": editorErrorResponseSchema,
};

function render(name: string, schema: z.ZodType<unknown>): string {
    const json = zodToJsonSchema(schema, {
        name,
        $refStrategy: "none",
        target: "jsonSchema7",
    });
    return `${JSON.stringify(json, null, 2)}\n`;
}

const checkMode = process.argv.includes("--check");
mkdirSync(OUT_DIR, { recursive: true });

const drifted: string[] = [];
for (const [name, schema] of Object.entries(CONTRACTS)) {
    const file = join(OUT_DIR, `${name}.schema.json`);
    const next = render(name, schema);
    if (checkMode) {
        const current = existsSync(file) ? readFileSync(file, "utf8") : null;
        if (current !== next) drifted.push(file);
    } else {
        writeFileSync(file, next);
    }
}

if (checkMode) {
    if (drifted.length > 0) {
        console.error(
            `JSON Schemas are stale (run \`pnpm --filter @launchstack/protocol schemas:generate\`):\n` +
                drifted.map(f => `  - ${f}`).join("\n")
        );
        process.exit(1);
    }
    console.log(`schemas:check ok (${Object.keys(CONTRACTS).length} contracts)`);
} else {
    console.log(`wrote ${Object.keys(CONTRACTS).length} schemas to ${OUT_DIR}`);
}
