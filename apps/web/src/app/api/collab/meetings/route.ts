/**
 * Meetings collection: list what this workspace has run, and start a new one.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import type { AgentPersona } from "@launchstack/core/collab";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { createMeetingForCompany, listMeetingsForCompany } from "~/server/collab/runtime";
import { ensureStarterPersonas, listPersonas } from "~/server/collab/personas";
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

  const channelById = new Map(channels.map((c) => [c.id, c]));

  return NextResponse.json({
    meetings: rows.map((row) => ({
      id: row.id,
      title: row.title,
      objective: row.objective,
      status: row.status,
      turnIndex: row.turnIndex,
      maxTurns: row.maxTurns,
      channelId: row.channelId,
      channelSlug: channelById.get(row.channelId)?.slug ?? null,
      participants: (row.participants as AgentPersona[]).map((p) => ({
        id: p.id,
        displayName: p.displayName,
        role: p.role,
        nodeId: p.nodeId ?? null,
        accent: p.accent ?? null,
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
      { status: 400 },
    );
  }
  const input = parsed.data;

  const { companyId, clerkUserId } = ctx.data;
  // A workspace that has never opened the Agents pane still gets a usable
  // roster, so "start a meeting" never dead-ends on an empty picker.
  const roster = await ensureStarterPersonas(companyId).catch(() => listPersonas(companyId));

  const byKey = new Map(roster.map((p) => [p.id, p]));
  const participants: AgentPersona[] = [];
  for (const key of input.participantKeys) {
    const persona = byKey.get(key);
    if (!persona) {
      return NextResponse.json({ error: `Unknown participant "${key}"` }, { status: 400 });
    }
    participants.push({
      id: persona.id,
      displayName: persona.displayName,
      role: persona.role,
      systemPrompt: persona.systemPrompt,
      nodeId: persona.nodeId,
      route: persona.route,
      temperature: persona.temperature,
      maxTurnChars: persona.maxTurnChars,
      accent: persona.accent,
    });
  }

  if (input.moderatorKey && !byKey.has(input.moderatorKey)) {
    return NextResponse.json({ error: `Unknown moderator "${input.moderatorKey}"` }, { status: 400 });
  }

  const { row, orchestrator } = await createMeetingForCompany({
    companyId,
    createdByUserId: clerkUserId,
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
    { status: 201 },
  );
}
