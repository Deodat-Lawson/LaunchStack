import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "~/server/db";
import { studyAgentProfile } from "~/server/db/schema";
import { resolveSessionForUser } from "~/server/study-agent/session";

// Helper to convert BigInt values to numbers for JSON serialization
function serializeBigInt<T>(obj: T): T {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === "bigint") return Number(obj) as unknown as T;
    if (Array.isArray(obj)) return obj.map(serializeBigInt) as unknown as T;
    if (typeof obj === "object") {
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj)) {
            result[key] = serializeBigInt(value);
        }
        return result as T;
    }
    return obj;
}

function parseSessionId(request: Request) {
    const sessionIdParam = new URL(request.url).searchParams.get("sessionId");
    const parsedSessionId = sessionIdParam ? Number(sessionIdParam) : undefined;
    return Number.isNaN(parsedSessionId) ? undefined : parsedSessionId;
}

const aiProfileSchema = z.object({
    aiName: z.string().trim().optional(),
    aiGender: z.string().trim().optional(),
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

        const [profile] = await db
            .select()
            .from(studyAgentProfile)
            .where(
                and(
                    eq(studyAgentProfile.userId, userId),
                    eq(studyAgentProfile.sessionId, BigInt(session.id))
                )
            );

        const aiProfile = profile
            ? {
                  aiName: profile.aiName ?? undefined,
                  aiGender: profile.aiGender ?? undefined,
                  aiAvatarUrl: profile.aiAvatarUrl ?? undefined,
                  aiPersonality:
                      profile.aiExtroversion !== null &&
                      profile.aiIntuition !== null &&
                      profile.aiThinking !== null &&
                      profile.aiJudging !== null
                          ? {
                                extroversion: Number(profile.aiExtroversion),
                                intuition: Number(profile.aiIntuition),
                                thinking: Number(profile.aiThinking),
                                judging: Number(profile.aiJudging),
                            }
                          : undefined,
              }
            : null;

        return NextResponse.json({ profile: aiProfile, session: serializeBigInt(session) });
    } catch (error) {
        console.error("Error fetching study agent profile", error);
        return NextResponse.json(
            { error: "Failed to load profile" },
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

        const rawBody = (await request.json().catch(() => ({}))) as {
            sessionId?: number | string;
            aiName?: string | null;
            aiGender?: string | null;
            aiAvatarUrl?: string | null;
            aiPersonality?: {
                extroversion?: number | null;
                intuition?: number | null;
                thinking?: number | null;
                judging?: number | null;
            } | null;
        };

        const parsed = aiProfileSchema.safeParse(rawBody);
        if (!parsed.success) {
            return NextResponse.json(
                { error: "Invalid profile payload", details: parsed.error.flatten() },
                { status: 400 }
            );
        }

        const session = await resolveSessionForUser(
            userId,
            typeof rawBody.sessionId === "number"
                ? rawBody.sessionId
                : typeof rawBody.sessionId === "string"
                ? Number(rawBody.sessionId)
                : parseSessionId(request)
        );

        if (!session) {
            return NextResponse.json({ error: "Session not found" }, { status: 404 });
        }

        const payload = {
            aiName: parsed.data.aiName ?? null,
            aiGender: parsed.data.aiGender ?? null,
            aiAvatarUrl: parsed.data.aiAvatarUrl ?? null,
            aiExtroversion: parsed.data.aiPersonality?.extroversion ?? null,
            aiIntuition: parsed.data.aiPersonality?.intuition ?? null,
            aiThinking: parsed.data.aiPersonality?.thinking ?? null,
            aiJudging: parsed.data.aiPersonality?.judging ?? null,
        };

        const [existing] = await db
            .select()
            .from(studyAgentProfile)
            .where(
                and(
                    eq(studyAgentProfile.userId, userId),
                    eq(studyAgentProfile.sessionId, BigInt(session.id))
                )
            );

        if (existing) {
            const [updated] = await db
                .update(studyAgentProfile)
                .set(payload)
                .where(
                    and(
                        eq(studyAgentProfile.userId, userId),
                        eq(studyAgentProfile.sessionId, BigInt(session.id))
                    )
                )
                .returning();

            return NextResponse.json({ profile: serializeBigInt(updated), session: serializeBigInt(session) });
        }

        const [created] = await db
            .insert(studyAgentProfile)
            .values({ ...payload, userId, sessionId: BigInt(session.id) })
            .returning();

        return NextResponse.json({ profile: serializeBigInt(created), session: serializeBigInt(session) }, { status: 201 });
    } catch (error) {
        console.error("Error saving study agent profile", error);
        return NextResponse.json(
            { error: "Failed to save profile" },
            { status: 500 }
        );
    }
}

export async function DELETE(request: Request) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const session = await resolveSessionForUser(userId, parseSessionId(request));
        if (!session) {
            return NextResponse.json({ error: "Session not found" }, { status: 404 });
        }

        await db
            .delete(studyAgentProfile)
            .where(
                and(
                    eq(studyAgentProfile.userId, userId),
                    eq(studyAgentProfile.sessionId, BigInt(session.id))
                )
            );
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Error deleting study agent profile", error);
        return NextResponse.json(
            { error: "Failed to delete profile" },
            { status: 500 }
        );
    }
}
