import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

import { db } from "~/server/db";
import {
  studyAgentPreferences,
  studyAgentProfile,
  studyAgentSessions,
} from "~/server/db/schema";
import { serializeBigInt } from "../../shared";

const preferencesSchema = z.object({
  selectedDocuments: z.array(z.string()).default([]),
  name: z.string().trim().optional(),
  grade: z.string(),
  gender: z.string(),
  fieldOfStudy: z.string(),
  mode: z.enum(["teacher", "study-buddy"]),
  aiGender: z.string().optional(),
  aiName: z.string().trim().optional(),
  aiAvatarUrl: z.string().trim().optional(),
  aiPersonality: z
    .object({
      extroversion: z.number(),
      intuition: z.number(),
      thinking: z.number(),
      judging: z.number(),
    })
    .optional(),
});

export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      preferences?: unknown;
    };

    const parsed = preferencesSchema.safeParse(body.preferences ?? body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid preferences payload",
          details: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }

    const preferences = parsed.data;
    const sessionName =
      preferences.name && preferences.name.length > 0
        ? preferences.name
        : "Default Session";

    const result = await db.transaction(async (tx) => {
      const [session] = await tx
        .insert(studyAgentSessions)
        .values({ userId, name: sessionName, mode: preferences.mode })
        .returning();
      if (!session) {
        throw new Error("Failed to persist session");
      }

      const sessionId = BigInt(session.id);

      const [profile] = await tx
        .insert(studyAgentProfile)
        .values({
          userId,
          sessionId,
          aiName: preferences.aiName ?? null,
          aiGender: preferences.aiGender ?? null,
          aiAvatarUrl: preferences.aiAvatarUrl ?? null,
          aiExtroversion: preferences.aiPersonality?.extroversion ?? null,
          aiIntuition: preferences.aiPersonality?.intuition ?? null,
          aiThinking: preferences.aiPersonality?.thinking ?? null,
          aiJudging: preferences.aiPersonality?.judging ?? null,
        })
        .returning();

      const [prefs] = await tx
        .insert(studyAgentPreferences)
        .values({
          userId,
          sessionId,
          selectedDocuments: preferences.selectedDocuments ?? [],
          userName: preferences.name ?? null,
          userGrade: preferences.grade ?? null,
          userGender: preferences.gender ?? null,
          fieldOfStudy: preferences.fieldOfStudy ?? null,
        })
        .returning();

      return { session, profile, preferences: prefs };
    });

    if (!result.preferences) {
      throw new Error("Failed to persist preferences");
    }

    const assembledPreferences = {
      selectedDocuments: result.preferences.selectedDocuments ?? [],
      name: preferences.name,
      grade: preferences.grade,
      gender: preferences.gender,
      fieldOfStudy: preferences.fieldOfStudy,
      mode: preferences.mode,
      aiGender: preferences.aiGender,
      aiName: preferences.aiName,
      aiAvatarUrl: preferences.aiAvatarUrl,
      aiPersonality: preferences.aiPersonality,
    };

    return NextResponse.json(
      {
        session: serializeBigInt(result.session),
        profile: serializeBigInt(result.profile),
        preferences: assembledPreferences,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creating study agent session", error);
    return NextResponse.json(
      { error: "Failed to create session" },
      { status: 500 }
    );
  }
}