/**
 * Meetings collection: list what this workspace has run, and start a new one.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { phasePlanProblems, type AgentPersona, type MeetingPhase } from "@launchstack/collab";
import { meetingWorkflow } from "~/lib/agents/meeting-workflows";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { assertMeetingPlanAllowed } from "~/server/collab/autonomy";
import { createMeetingForCompany, listMeetingsForCompany } from "~/server/collab/runtime";
import { isWorkspaceError } from "~/server/workspace/errors";
import {
    ensureStarterPersonas,
    listPersonas,
    personaToParticipant,
} from "~/server/collab/personas";
import { getChannelStore } from "~/server/collab/store";

export const dynamic = "force-dynamic";

const CreateMeetingSchema = z.object({
    title: z.string().min(1).max(200),
    objective: z.string().min(1).max(2000),
    agenda: z.array(z.string().min(1).max(300)).max(20).optional(),
    /** Persona keys from the workspace roster. */
    participantKeys: z.array(z.string().min(1)).min(1).max(10),
    turnPolicy: z.enum(["round_robin", "moderated", "reactive"]).optional(),
    moderatorKey: z.string().optional(),
    maxTurns: z.number().int().min(1).max(60).optional(),
    context: z.array(z.string().max(4000)).max(20).optional(),
    /** The workflow template the plan came from, for the room header. */
    workflowKey: z.string().max(64).optional(),
    /** The phase plan the engine walks. Speakers must be in the room. */
    phases: z
        .array(
            z.object({
                id: z.string().min(1).max(48),
                title: z.string().min(1).max(80),
                goal: z.string().min(1).max(600),
                turns: z.number().int().min(1).max(30),
                speakerIds: z.array(z.string().min(1)).max(10).optional(),
            })
        )
        .max(12)
        .optional(),
    channelId: z.string().optional(),
    slackChannelId: z.string().optional(),
    slackMirrorEnabled: z.boolean().optional(),
    slackUseAgentIdentity: z.boolean().optional(),
    /** Start the meeting immediately instead of leaving it scheduled. */
    autoStart: z.boolean().optional(),
});

export async function GET() {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;

    const { companyId } = ctx.data;
    const [rows, channels] = await Promise.all([
        listMeetingsForCompany(companyId),
        getChannelStore().listChannels(String(companyId)),
    ]);

    const channelById = new Map(channels.map(c => [c.id, c]));

    return NextResponse.json({
        meetings: rows.map(row => ({
            id: row.id,
            title: row.title,
            objective: row.objective,
            status: row.status,
            turnIndex: row.turnIndex,
            maxTurns: row.maxTurns,
            channelId: row.channelId,
            channelSlug: channelById.get(row.channelId)?.slug ?? null,
            participants: (row.participants as AgentPersona[]).map(p => ({
                id: p.id,
                displayName: p.displayName,
                role: p.role,
                nodeId: p.nodeId ?? null,
                accent: p.accent ?? null,
                avatarUrl: p.avatarUrl ?? null,
            })),
            workflowKey: row.workflowKey ?? null,
            workflowTitle: meetingWorkflow(row.workflowKey)?.title ?? null,
            phases: (row.phases ?? []).map(phase => ({
                id: phase.id,
                title: phase.title,
                turns: phase.turns,
            })),
            slackChannelId: row.slackChannelId,
            slackMirrorEnabled: row.slackMirrorEnabled,
            createdAt: row.createdAt.toISOString(),
            startedAt: row.startedAt?.toISOString() ?? null,
            endedAt: row.endedAt?.toISOString() ?? null,
        })),
    });
}

export async function POST(request: Request) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;

    const parsed = CreateMeetingSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json(
            { error: "Invalid request", details: parsed.error.flatten() },
            { status: 400 }
        );
    }
    const input = parsed.data;

    const { companyId, authUserId } = ctx.data;
    // A workspace that has never opened the Agents pane still gets a usable
    // roster, so "start a meeting" never dead-ends on an empty picker.
    const roster = await ensureStarterPersonas(companyId).catch(() => listPersonas(companyId));

    const byKey = new Map(roster.map(p => [p.id, p]));
    const participants: AgentPersona[] = [];
    for (const key of input.participantKeys) {
        const persona = byKey.get(key);
        if (!persona) {
            return NextResponse.json({ error: `Unknown participant "${key}"` }, { status: 400 });
        }
        participants.push(personaToParticipant(persona));
    }

    if (input.moderatorKey && !byKey.has(input.moderatorKey)) {
        return NextResponse.json(
            { error: `Unknown moderator "${input.moderatorKey}"` },
            { status: 400 }
        );
    }

    // A phase plan is a promise about the transcript's shape; refuse one the
    // engine could not keep (a phase whose speakers are all absent, say).
    const phases: MeetingPhase[] | undefined = input.phases?.map(phase => ({
        id: phase.id,
        title: phase.title,
        goal: phase.goal,
        turns: phase.turns,
        ...(phase.speakerIds && phase.speakerIds.length > 0
            ? { speakerIds: phase.speakerIds.filter(id => byKey.has(id)) }
            : {}),
    }));
    const planProblems = phasePlanProblems(phases, participants);
    if (planProblems.length > 0) {
        return NextResponse.json({ error: planProblems.join(" ") }, { status: 400 });
    }
    if (
        input.workflowKey &&
        input.workflowKey !== "custom" &&
        !meetingWorkflow(input.workflowKey)
    ) {
        return NextResponse.json(
            { error: `Unknown workflow "${input.workflowKey}"` },
            { status: 400 }
        );
    }

    // What the room may do is decided by its least autonomous agent.
    try {
        await assertMeetingPlanAllowed(companyId, {
            participantKeys: input.participantKeys,
            slackMirrorEnabled: input.slackMirrorEnabled,
            slackUseAgentIdentity: input.slackUseAgentIdentity,
        });
    } catch (err) {
        if (isWorkspaceError(err)) {
            return NextResponse.json({ error: err.message }, { status: err.status });
        }
        throw err;
    }

    const { row, orchestrator } = await createMeetingForCompany({
        companyId,
        createdByUserId: authUserId,
        title: input.title,
        objective: input.objective,
        agenda: input.agenda,
        participants,
        turnPolicy: {
            kind: input.turnPolicy ?? "round_robin",
            moderatorId: input.moderatorKey,
        },
        maxTurns: input.maxTurns,
        context: input.context,
        phases,
        workflowKey: input.workflowKey,
        channelId: input.channelId,
        slackChannelId: input.slackChannelId,
        slackMirrorEnabled: input.slackMirrorEnabled,
        slackUseAgentIdentity: input.slackUseAgentIdentity,
    });

    if (input.autoStart) await orchestrator.start();

    return NextResponse.json(
        {
            meeting: {
                id: row.id,
                channelId: row.channelId,
                title: row.title,
                objective: row.objective,
                state: orchestrator.getState(),
            },
        },
        { status: 201 }
    );
}
