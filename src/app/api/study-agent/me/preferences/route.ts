/**
 * Study Agent Preferences API
 * Role: CRUD for user-specific study-agent preferences per session.
 * Purpose: persist configurable settings used by agent behavior.
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "~/server/db";
import { studyAgentPreferences } from "~/server/db/schema";
import { resolveSessionForUser } from "~/server/study-agent/session";
import { parseSessionId, serializeBigInt } from "../../shared";

const preferencesSchema = z.object({
  selectedDocuments: z.array(z.string()).default([]),
  name: z.string().trim().optional(),
  grade: z.string(),
  gender: z.string(),
  fieldOfStudy: z.string(),
  mode: z.enum(["teacher", "study-buddy"]),
});

function toPreferencesResponse(row: typeof studyAgentPreferences.$inferSelect) {
  if (!row) return null;

  return {
    selectedDocuments: row.selectedDocuments ?? [],
    name: row.userName ?? undefined,
    grade: row.userGrade ?? undefined,
    gender: row.userGender ?? undefined,
    fieldOfStudy: row.fieldOfStudy ?? undefined,
  };
}

export async function GET(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const session = await resolveSessionForUser(userId, parseSessionId(request));
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const [preferences] = await db
      .select()
      .from(studyAgentPreferences)
      .where(
        and(
          eq(studyAgentPreferences.userId, userId),
          eq(studyAgentPreferences.sessionId, BigInt(session.id))
        )
      );

    return NextResponse.json({
      preferences: preferences ? toPreferencesResponse(preferences) : null,
      session: serializeBigInt(session),
    });
  } catch (error) {
    console.error("Error fetching study agent preferences", error);
    return NextResponse.json(
      { error: "Failed to load preferences" },
      { status: 500 }
    );
  }
}
export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      sessionId?: number;
      preferences?: unknown;
    };

    const parsed = preferencesSchema.safeParse(body.preferences ?? body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid preferences payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const preferences = parsed.data;

    const session = await resolveSessionForUser(
      userId,
      body.sessionId ?? parseSessionId(request)
    );

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const [existing] = await db
      .select()
      .from(studyAgentPreferences)
      .where(
        and(
          eq(studyAgentPreferences.userId, userId),
          eq(studyAgentPreferences.sessionId, BigInt(session.id))
        )
      );

    const payload = {
      selectedDocuments: preferences.selectedDocuments ?? [],
      userName: preferences.name ?? null,
      userGrade: preferences.grade ?? null,
      userGender: preferences.gender ?? null,
      fieldOfStudy: preferences.fieldOfStudy ?? null,
    };

    if (existing) {
      const [updated] = await db
        .update(studyAgentPreferences)
        .set(payload)
        .where(
          and(
            eq(studyAgentPreferences.userId, userId),
            eq(studyAgentPreferences.sessionId, BigInt(session.id))
          )
        )
        .returning();

      return NextResponse.json({
        preferences: updated ? toPreferencesResponse(updated) : null,
        session: serializeBigInt(session),
      });
    }

    const [created] = await db
      .insert(studyAgentPreferences)
      .values({ userId, sessionId: BigInt(session.id), ...payload })
      .returning();

    return NextResponse.json(
      {
        preferences: created ? toPreferencesResponse(created) : null,
        session: serializeBigInt(session),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error saving study agent preferences", error);
    return NextResponse.json({ error: "Failed to save preferences" }, { status: 500 });
  }
}