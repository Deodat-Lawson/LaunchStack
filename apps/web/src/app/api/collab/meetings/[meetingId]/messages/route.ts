/**
 * Human messages into a meeting channel.
 *
 * A person can post whether or not they hold the floor — the same as walking
 * into a Slack channel and typing. Taking over is a separate, explicit act
 * (see `../control`).
 */

import { NextResponse } from "next/server";
import { getServerSession } from "~/server/auth";
import { z } from "zod";

import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { getMeetingRuntime } from "~/server/collab/runtime";

export const dynamic = "force-dynamic";

const PostMessageSchema = z.object({
    text: z.string().min(1).max(8000),
    /** Speak through an agent's seat. Defaults to whatever seat is held. */
    asPersonaId: z.string().optional(),
    threadId: z.string().optional(),
});

export async function POST(
    request: Request,
    { params }: { params: Promise<{ meetingId: string }> }
) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;

    const parsed = PostMessageSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json(
            { error: "Invalid request", details: parsed.error.flatten() },
            { status: 400 }
        );
    }

    const { meetingId } = await params;
    const runtime = await getMeetingRuntime(meetingId, ctx.data.companyId);
    if (!runtime) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });

    const session = await getServerSession();
    const trimmedName = session?.user.name.trim();
    const displayName = trimmedName?.length ? trimmedName : (session?.user.email ?? "Teammate");

    try {
        const message = await runtime.orchestrator.postHumanMessage({
            humanId: ctx.data.authUserId,
            displayName,
            text: parsed.data.text,
            asPersonaId: parsed.data.asPersonaId,
            threadId: parsed.data.threadId,
        });
        return NextResponse.json(
            { message, state: runtime.orchestrator.getState() },
            { status: 201 }
        );
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Could not post message" },
            { status: 400 }
        );
    }
}
