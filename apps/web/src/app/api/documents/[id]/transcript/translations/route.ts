/**
 * POST /api/documents/[id]/transcript/translations  { language: "en" }
 *
 * A transcript's lines in another language, one for one with the original,
 * so the viewer can show a translated line at its original's timestamp. The
 * first request translates (seconds for a short clip, under a minute for a
 * long meeting) and stores the result in the transcript's `ocrMetadata`;
 * later requests, from anyone who can read the transcript, are served from it.
 *
 * Reading the transcript is the only permission asked: a translation is a
 * derived view of text the caller can already see, like its search snippet,
 * not an edit to the document. The original transcript is never changed, and
 * only the original is indexed and cited.
 */

import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "~/server/db";
import { document } from "@launchstack/store/schema";
import { isTranscriptionError, translateTranscriptLines } from "@launchstack/conversion";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { scopedDocumentWhere } from "~/lib/authz/scope";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { fetchFile } from "~/lib/storage";
import { getEngine } from "~/server/engine";
import {
    canonicalLanguage,
    hasTranscriptTitle,
    storedTranslationOf,
    transcriptMarkerOf,
    type TranscriptTranslationResponse,
} from "~/lib/media-document";
import { validateRequestBody } from "~/lib/validation";

export const maxDuration = 300;

interface RouteParams {
    params: Promise<{ id: string }>;
}

const BodySchema = z.object({ language: z.string().min(2).max(20) });

export async function POST(request: Request, { params }: RouteParams) {
    // A cache hit costs nothing, but a miss is a paid model call per batch.
    return withRateLimit(request, RateLimitPresets.standard, async () => {
        try {
            const ctx = await requireWorkspaceContext();
            if (!ctx.success) return ctx.response;

            const { id } = await params;
            const docId = Number(id);
            if (!Number.isInteger(docId) || docId <= 0) {
                return NextResponse.json({ error: "Invalid document ID" }, { status: 400 });
            }

            const validation = await validateRequestBody(request, BodySchema);
            if (!validation.success) return validation.response;
            const language = canonicalLanguage(validation.data.language);
            if (!language) {
                return NextResponse.json({ error: "Unknown language code" }, { status: 400 });
            }

            const inScope = scopedDocumentWhere(ctx.data.companyId, await ctx.data.documentScope());
            const [doc] = await db
                .select({
                    id: document.id,
                    title: document.title,
                    url: document.url,
                    ocrMetadata: document.ocrMetadata,
                })
                .from(document)
                .where(and(eq(document.id, docId), inScope));
            // Out of scope reads exactly like missing.
            if (!doc) {
                return NextResponse.json({ error: "Document not found" }, { status: 404 });
            }

            const marker = transcriptMarkerOf(doc.ocrMetadata);
            if (!marker && !hasTranscriptTitle(doc.title)) {
                return NextResponse.json(
                    { error: "This document is not a transcript" },
                    { status: 400 }
                );
            }

            // The unit of translation is the line the viewer shows: a segment
            // when there are timestamps, otherwise a line of the plain text.
            let lines: string[];
            if (marker?.segments) {
                lines = marker.segments.map(s => s.text);
            } else {
                const res = await fetchFile(doc.url);
                if (!res.ok) {
                    return NextResponse.json(
                        { error: "Couldn't read the transcript from storage" },
                        { status: 502 }
                    );
                }
                lines = (await res.text()).trim().split(/\r?\n/);
            }
            if (lines.every(l => l.trim() === "")) {
                return NextResponse.json({ error: "This transcript is empty" }, { status: 400 });
            }

            const stored = storedTranslationOf(doc.ocrMetadata, language, lines.length);
            if (stored) {
                return NextResponse.json({
                    language,
                    lines: stored.lines,
                    cached: true,
                } satisfies TranscriptTranslationResponse);
            }

            // Registers the provider config the endpoint resolver reads.
            getEngine();
            const started = Date.now();
            const translation = await translateTranscriptLines(lines, language);
            console.log(
                `[TranscriptTranslation] doc=${doc.id} → ${language}: ${lines.length} lines via ${translation.model} in ${Date.now() - started}ms (${translation.tokens} tokens)`
            );

            // One statement, merged into whatever is there now: OCR completion
            // and a concurrent translation into another language both survive.
            const entry = {
                lines: translation.lines,
                model: translation.model,
                translatedAt: new Date().toISOString(),
            };
            await db
                .update(document)
                .set({
                    ocrMetadata: sql`coalesce(${document.ocrMetadata}, '{}'::jsonb) || jsonb_build_object('translations', coalesce(${document.ocrMetadata}->'translations', '{}'::jsonb) || jsonb_build_object(${language}::text, ${JSON.stringify(entry)}::jsonb))`,
                })
                .where(eq(document.id, doc.id));

            return NextResponse.json({
                language,
                lines: translation.lines,
                cached: false,
            } satisfies TranscriptTranslationResponse);
        } catch (error) {
            if (isTranscriptionError(error)) {
                console.error(`[TranscriptTranslation] ${error.message}`);
                return NextResponse.json({ error: error.userMessage }, { status: error.status });
            }
            console.error("[TranscriptTranslation] Failed:", error);
            return NextResponse.json({ error: "Translation failed" }, { status: 500 });
        }
    });
}
