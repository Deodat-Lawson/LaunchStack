import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import { buildCompanyKnowledgeContext } from "@launchstack/features/marketing-pipeline";
import {
  scorePost,
  type ReferencePlatform,
} from "@launchstack/features/marketing-pipeline/benchmark";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/marketing-pipeline/evaluate
 * Runs the LLM-as-judge (raw scores, no rewrite) on a single post, using the
 * same company-context window the generator built. Body: { message, platform }.
 */

const REFERENCE_PLATFORMS = new Set(["x", "linkedin", "reddit"]);

const EvaluateBodySchema = z.object({
  message: z.string().min(1).max(5000),
  platform: z.string().max(40).optional(),
  // Context the generator actually used (from the pipeline result). When
  // present we score against these exact facts instead of re-deriving.
  companyContext: z.string().max(20000).optional(),
  prompt: z.string().max(2000).optional(),
  dna: z.unknown().optional(),
  brandVoice: z.unknown().optional(),
  targetPersona: z.unknown().optional(),
});

/** Platforms we already warned about — one missing-reference warning each. */
const warnedMissingReferences = new Set<string>();

/** Load the platform reference md (blank until curated) — empty if not found. */
function loadReferenceMarkdown(platform: string): string {
  if (!REFERENCE_PLATFORMS.has(platform)) return "";
  const rel = `packages/features/src/marketing-pipeline/benchmark/references/${platform}.md`;
  const candidates = [
    path.resolve(process.cwd(), "../..", rel), // dev: cwd = apps/web
    path.resolve(process.cwd(), rel), // cwd = repo root
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
    } catch {
      /* try next candidate */
    }
  }
  if (!warnedMissingReferences.has(platform)) {
    warnedMissingReferences.add(platform);
    console.warn(
      `[marketing-pipeline/evaluate] reference markdown for "${platform}" not found (looked in ${candidates.join(", ")}); scoring without a reference. In standalone builds this requires the outputFileTracingIncludes entry in next.config.ts.`,
    );
  }
  return "";
}

/**
 * Compose the same context surface the generator saw: the knowledge context
 * plus DNA, brand voice, and persona. Groundedness/brand-voice/audience
 * criteria are then judged against exactly what the post was written from.
 */
function composeEvalContext(
  base: string,
  extras: { dna?: unknown; brandVoice?: unknown; targetPersona?: unknown },
): string {
  const parts: string[] = [base.trim()];
  const add = (label: string, value: unknown) => {
    if (value == null) return;
    parts.push(`=== ${label} ===\n${JSON.stringify(value, null, 2)}`);
  };
  add("Company DNA", extras.dna);
  add("Brand Voice", extras.brandVoice);
  add("Target Persona", extras.targetPersona);
  return parts.filter(Boolean).join("\n\n");
}

export async function POST(request: Request) {
  try {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;

    let raw: unknown;
    try {
      raw = (await request.json()) as unknown;
    } catch {
      return NextResponse.json(
        { success: false, message: "Invalid JSON body" },
        { status: 400 },
      );
    }

    const parsed = EvaluateBodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid input",
          errors: parsed.error.flatten(),
        },
        { status: 400 },
      );
    }
    const body = parsed.data;

    const message = body.message.trim();
    const platform = body.platform ?? "";
    if (!message) {
      return NextResponse.json(
        { success: false, message: "message is required" },
        { status: 400 },
      );
    }

    // The judge is typed for x/linkedin/reddit; bluesky falls back to the x
    // rubric with an empty reference.
    const judgePlatform: ReferencePlatform =
      platform === "linkedin" || platform === "reddit" ? platform : "x";

    const companyId = Number(ctx.data.companyId);
    if (Number.isNaN(companyId)) {
      return NextResponse.json(
        { success: false, message: "Invalid company ID" },
        { status: 400 },
      );
    }

    // Prefer the exact knowledge context the generator used (passed from the
    // pipeline result). Fall back to rebuilding it with the ORIGINAL campaign
    // prompt (not the post text) so the RAG query matches generation.
    const passedContext = body.companyContext?.trim();
    const trimmedPrompt = body.prompt?.trim();
    const baseContext =
      passedContext && passedContext.length > 0
        ? passedContext
        : await buildCompanyKnowledgeContext({
            companyId,
            prompt:
              trimmedPrompt && trimmedPrompt.length > 0
                ? trimmedPrompt
                : message,
          });

    const companyContext = composeEvalContext(baseContext, {
      dna: body.dna,
      brandVoice: body.brandVoice,
      targetPersona: body.targetPersona,
    });

    const scored = await scorePost({
      platform: judgePlatform,
      companyContext,
      post: message,
      // Read the reference md for the SAME platform the post was generated for.
      referenceMarkdown: loadReferenceMarkdown(platform),
    });

    return NextResponse.json({ success: true, data: scored });
  } catch (error) {
    console.error("[marketing-pipeline/evaluate] failed:", error);
    return NextResponse.json(
      {
        success: false,
        message: "Failed to evaluate post",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
