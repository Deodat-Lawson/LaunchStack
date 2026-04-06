/**
 * GitHub Repository Ingestion API Route
 *
 * Accepts a public GitHub repository URL and dispatches an Inngest
 * background job to fetch, process, and embed the repo's contents.
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "~/server/db";
import { users } from "~/server/db/schema";
import { validateRequestBody } from "~/lib/validation";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { parseGitHubUrl } from "~/lib/ingestion/services/github-repo";
import { inngest } from "~/server/inngest/client";

const IngestGitHubSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
  repoUrl: z
    .string()
    .url("Must be a valid URL")
    .refine(
      (u) => u.includes("github.com/"),
      "Must be a GitHub repository URL",
    ),
  category: z.string().optional(),
  includeCode: z.boolean().optional().default(true),
  branch: z.string().optional(),
  path: z.string().optional(),
});

export async function POST(request: Request) {
  return withRateLimit(request, RateLimitPresets.strict, async () => {
    try {
      const validation = await validateRequestBody(request, IngestGitHubSchema);
      if (!validation.success) {
        return validation.response;
      }

      const data = validation.data;
      const { userId, repoUrl, category } = data;
      const includeCode = data.includeCode ?? true;
      const branch = data.branch;
      const path = data.path;

      const parsed = parseGitHubUrl(repoUrl);
      if (!parsed) {
        return NextResponse.json(
          { error: "Invalid GitHub URL. Expected format: https://github.com/owner/repo" },
          { status: 400 },
        );
      }

      console.log(
        `[IngestGitHub] Incoming: ${parsed.owner}/${parsed.repo}, includeCode=${includeCode}, user=${userId}`,
      );

      const [userInfo] = await db
        .select()
        .from(users)
        .where(eq(users.userId, userId));

      if (!userInfo) {
        return NextResponse.json(
          { error: "Invalid user" },
          { status: 400 },
        );
      }

      const companyIdString = userInfo.companyId.toString();
      const documentCategory = category ?? "GitHub Repos";

      const eventIds = await inngest.send({
        name: "github/ingest.requested",
        data: {
          repoUrl,
          owner: parsed.owner,
          repo: parsed.repo,
          branch: branch ?? parsed.branch,
          path: path ?? parsed.path,
          includeCode,
          companyId: companyIdString,
          userId,
          category: documentCategory,
        },
      });

      console.log(
        `[IngestGitHub] Job dispatched: ${parsed.owner}/${parsed.repo}`,
      );

      return NextResponse.json(
        {
          success: true,
          message: `GitHub repository ingestion started for ${parsed.owner}/${parsed.repo}`,
          repo: {
            owner: parsed.owner,
            repo: parsed.repo,
            branch: branch ?? parsed.branch ?? "default",
          },
          eventIds: Array.isArray(eventIds) ? eventIds : [eventIds],
        },
        { status: 202 },
      );
    } catch (error) {
      console.error("[IngestGitHub] Error:", error);
      return NextResponse.json(
        {
          error: "Failed to start GitHub ingestion",
          details: error instanceof Error ? error.message : "Unknown error",
        },
        { status: 500 },
      );
    }
  });
}
