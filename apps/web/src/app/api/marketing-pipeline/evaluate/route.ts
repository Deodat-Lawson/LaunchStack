import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";

import { db } from "~/server/db";
import { users } from "@launchstack/core/db/schema";
import { buildCompanyKnowledgeContext } from "@launchstack/features/marketing-pipeline";
import {
  scorePost,
  type ReferencePlatform,
} from "@launchstack/features/marketing-pipeline/benchmark";
import { resolveActiveCompanyForUser } from "~/lib/active-workspace";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/marketing-pipeline/evaluate
 * Runs the LLM-as-judge (raw scores, no rewrite) on a single post, using the
 * same company-context window the generator built. Body: { message, platform }.
 */

const REFERENCE_PLATFORMS = new Set(["x", "linkedin", "reddit"]);

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
  return "";
}

export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 },
      );
    }

    let body: { message?: string; platform?: string };
    try {
      body = (await request.json()) as { message?: string; platform?: string };
    } catch {
      return NextResponse.json(
        { success: false, message: "Invalid JSON body" },
        { status: 400 },
      );
    }

    const message = (body.message ?? "").trim();
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

    const [requestingUser] = await db
      .select()
      .from(users)
      .where(eq(users.userId, userId))
      .limit(1);
    if (!requestingUser) {
      return NextResponse.json(
        { success: false, message: "User not found" },
        { status: 404 },
      );
    }

    const companyId = Number(
      await resolveActiveCompanyForUser(
        requestingUser.id,
        requestingUser.companyId,
      ),
    );
    if (Number.isNaN(companyId)) {
      return NextResponse.json(
        { success: false, message: "Invalid company ID" },
        { status: 400 },
      );
    }

    // Rebuild the same company-context window generation used, so groundedness
    // is judged against the same facts the post was written from.
    const companyContext = await buildCompanyKnowledgeContext({
      companyId,
      prompt: message,
    });

    const scored = await scorePost({
      platform: judgePlatform,
      companyContext,
      post: message,
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
