/**
 * Rooms collection: what this workspace can ask, and creating a new one.
 *
 * A room's value comes from its members reading *different* things, so the
 * create path takes a document set per member rather than one for the room.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { ensureStarterPersonas, listPersonas } from "~/server/collab/personas";
import { createRoomForCompany, listRoomsForCompany, type RoomMember } from "~/server/collab/rooms";
import { getChannelStore } from "~/server/collab/store";

export const dynamic = "force-dynamic";

const CreateRoomSchema = z.object({
  name: z.string().min(1).max(200),
  purpose: z.string().max(2000).optional(),
  members: z
    .array(
      z.object({
        /** A persona key from the workspace roster. */
        personaKey: z.string().min(1),
        /**
         * Documents this member answers from. Capped because every round runs
         * one retrieval per member over this set.
         */
        documentIds: z.array(z.string().min(1).max(64)).max(50),
      }),
    )
    .min(1)
    .max(10),
});

export async function GET() {
  const ctx = await requireWorkspaceContext();
  if (!ctx.success) return ctx.response;

  const { companyId } = ctx.data;
  const [rows, channels] = await Promise.all([
    listRoomsForCompany(companyId),
    getChannelStore().listChannels(String(companyId)),
  ]);
  const channelById = new Map(channels.map((c) => [c.id, c]));

  return NextResponse.json({
    rooms: rows.map((row) => ({
      id: row.id,
      name: row.name,
      purpose: row.purpose,
      channelId: row.channelId,
      channelSlug: channelById.get(row.channelId)?.slug ?? null,
      members: (row.members as RoomMember[]).map((m) => ({
        id: m.id,
        displayName: m.displayName,
        role: m.role,
        accent: m.accent ?? null,
        documentCount: m.documentIds?.length ?? 0,
      })),
      createdAt: row.createdAt.toISOString(),
    })),
  });
}

export async function POST(request: Request) {
  const ctx = await requireWorkspaceContext();
  if (!ctx.success) return ctx.response;

  const parsed = CreateRoomSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const input = parsed.data;
  const { companyId, clerkUserId } = ctx.data;

  const roster = await ensureStarterPersonas(companyId).catch(() => listPersonas(companyId));
  const byKey = new Map(roster.map((p) => [p.id, p]));

  const members: RoomMember[] = [];
  for (const entry of input.members) {
    const persona = byKey.get(entry.personaKey);
    if (!persona) {
      return NextResponse.json(
        { error: `Unknown member "${entry.personaKey}"` },
        { status: 400 },
      );
    }
    if (members.some((m) => m.id === persona.id)) {
      return NextResponse.json(
        { error: `Member "${persona.id}" is listed twice` },
        { status: 400 },
      );
    }
    members.push({
      id: persona.id,
      displayName: persona.displayName,
      role: persona.role,
      systemPrompt: persona.systemPrompt,
      route: persona.route,
      temperature: persona.temperature,
      accent: persona.accent,
      documentIds: entry.documentIds,
    });
  }

  const row = await createRoomForCompany({
    companyId,
    createdByUserId: clerkUserId,
    name: input.name,
    purpose: input.purpose,
    members,
  });

  return NextResponse.json(
    { room: { id: row.id, name: row.name, channelId: row.channelId } },
    { status: 201 },
  );
}
