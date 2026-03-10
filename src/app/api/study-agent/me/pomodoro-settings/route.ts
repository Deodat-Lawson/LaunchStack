import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";

import { db } from "~/server/db";
import { studyAgentPomodoroSettings } from "~/server/db/schema";
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

        const [settings] = await db
            .select()
            .from(studyAgentPomodoroSettings)
            .where(
                and(
                    eq(studyAgentPomodoroSettings.userId, userId),
                    eq(studyAgentPomodoroSettings.sessionId, BigInt(session.id))
                )
            );

        return NextResponse.json({ pomodoroSettings: serializeBigInt(settings) ?? null, session: serializeBigInt(session) });
    } catch (error) {
        console.error("Error fetching pomodoro settings", error);
        return NextResponse.json(
            { error: "Failed to load pomodoro settings" },
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

        const body = (await request.json()) as {
            sessionId?: number | string;
            focusMinutes?: number;
            shortBreakMinutes?: number;
            longBreakMinutes?: number;
            sessionsBeforeLongBreak?: number;
            autoStartBreaks?: boolean;
            autoStartPomodoros?: boolean;
        };
        const session = await resolveSessionForUser(
            userId,
            typeof body.sessionId === "number"
                ? body.sessionId
                : typeof body.sessionId === "string"
                ? Number(body.sessionId)
                : parseSessionId(request)
        );

        if (!session) {
            return NextResponse.json({ error: "Session not found" }, { status: 404 });
        }

        const payload = {
            focusMinutes: body.focusMinutes ?? 25,
            shortBreakMinutes: body.shortBreakMinutes ?? 5,
            longBreakMinutes: body.longBreakMinutes ?? 15,
            sessionsBeforeLongBreak: body.sessionsBeforeLongBreak ?? 4,
            autoStartBreaks: Boolean(body.autoStartBreaks),
            autoStartPomodoros: Boolean(body.autoStartPomodoros),
        };

        const [existing] = await db
            .select()
            .from(studyAgentPomodoroSettings)
            .where(
                and(
                    eq(studyAgentPomodoroSettings.userId, userId),
                    eq(studyAgentPomodoroSettings.sessionId, BigInt(session.id))
                )
            );

        if (existing) {
            const [updated] = await db
                .update(studyAgentPomodoroSettings)
                .set(payload)
                .where(
                    and(
                        eq(studyAgentPomodoroSettings.userId, userId),
                        eq(studyAgentPomodoroSettings.sessionId, BigInt(session.id))
                    )
                )
                .returning();

            return NextResponse.json({ pomodoroSettings: serializeBigInt(updated), session: serializeBigInt(session) });
        }

        const [created] = await db
            .insert(studyAgentPomodoroSettings)
            .values({ ...payload, userId, sessionId: BigInt(session.id) })
            .returning();

        return NextResponse.json({ pomodoroSettings: serializeBigInt(created), session: serializeBigInt(session) }, { status: 201 });
    } catch (error) {
        console.error("Error saving pomodoro settings", error);
        return NextResponse.json(
            { error: "Failed to save pomodoro settings" },
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
            .delete(studyAgentPomodoroSettings)
            .where(
                and(
                    eq(studyAgentPomodoroSettings.userId, userId),
                    eq(studyAgentPomodoroSettings.sessionId, BigInt(session.id))
                )
            );
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Error deleting pomodoro settings", error);
        return NextResponse.json(
            { error: "Failed to delete pomodoro settings" },
            { status: 500 }
        );
    }
}
