/**
 * Room loading and the runtime stack a round is answered with.
 *
 * Stateless on purpose. A meeting keeps a cached live orchestrator because it
 * carries a turn cursor between requests; a room carries nothing between
 * rounds, so every request builds what it needs and throws it away. That is
 * also what makes rooms safe on more than one replica, which meetings are not.
 */

import { and, asc, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import {
  slugify,
  type AgentPersona,
  type AgentRuntime,
  type RoomConfig,
} from "@launchstack/core/collab";

import { collabRoom } from "~/server/db/schema";
import { db } from "~/server/db";
import { getChannelStore } from "./store";
import { WorkspaceQaRuntime, type QaMemberBinding } from "./qa-participant";

type RoomRow = typeof collabRoom.$inferSelect;

/** A member as stored: a persona plus the documents it answers from. */
export interface RoomMember extends AgentPersona {
  documentIds: string[];
}

export function rowToConfig(row: RoomRow): RoomConfig & { members: RoomMember[] } {
  return {
    id: row.id,
    channelId: row.channelId,
    workspaceId: String(row.companyId),
    name: row.name,
    purpose: row.purpose ?? undefined,
    members: row.members as RoomMember[],
  };
}

/**
 * The runtimes a round is answered with.
 *
 * Exactly one, deliberately. Every room member carries a document binding, so
 * the document-backed runtime always serves and a generic-LLM fallback could
 * never be reached — including it would only create a silent failure mode where
 * a misconfigured member stops citing anything and nothing says why. A member
 * with no documents declines explicitly instead, which is the honest answer.
 *
 * (This is also why room members are not subject to the ordering hazard on the
 * meeting path, where `LlmAgentRuntime` claims every persona without a node id
 * and must therefore be consulted last.)
 */
export function buildRoomRuntimes(input: {
  members: RoomMember[];
  actorUserId: string;
}): AgentRuntime[] {
  const bindings = new Map<string, QaMemberBinding>(
    input.members.map((m) => [m.id, { documentIds: m.documentIds ?? [] }]),
  );

  return [
    new WorkspaceQaRuntime({
      binding: (persona) => bindings.get(persona.id) ?? null,
      actorUserId: input.actorUserId,
    }),
  ];
}

export interface NewRoomInput {
  companyId: bigint;
  createdByUserId: string;
  name: string;
  purpose?: string;
  members: RoomMember[];
}

export async function createRoomForCompany(input: NewRoomInput) {
  const store = getChannelStore();
  const channelId = `chan_${randomUUID().replace(/-/g, "")}`;

  await store.createChannel({
    id: channelId,
    slug: await uniqueChannelSlug(input.companyId, slugify(input.name)),
    name: input.name,
    topic: input.purpose,
    workspaceId: String(input.companyId),
    createdByUserId: input.createdByUserId,
  });

  const [row] = await db
    .insert(collabRoom)
    .values({
      id: `room_${randomUUID().replace(/-/g, "")}`,
      companyId: input.companyId,
      channelId,
      name: input.name,
      purpose: input.purpose,
      members: input.members,
      createdByUserId: input.createdByUserId,
    })
    .returning();
  if (!row) throw new Error("Failed to create room");
  return row;
}

export async function getRoom(roomId: string, companyId: bigint): Promise<RoomRow | null> {
  const [row] = await db
    .select()
    .from(collabRoom)
    .where(and(eq(collabRoom.id, roomId), eq(collabRoom.companyId, companyId)))
    .limit(1);
  return row ?? null;
}

export async function listRoomsForCompany(companyId: bigint, limit = 50) {
  return db
    .select()
    .from(collabRoom)
    .where(and(eq(collabRoom.companyId, companyId), eq(collabRoom.archived, false)))
    .orderBy(desc(collabRoom.createdAt))
    .limit(limit);
}

async function uniqueChannelSlug(companyId: bigint, base: string): Promise<string> {
  const { collabChannel } = await import("~/server/db/schema");
  let candidate = base;
  let suffix = 1;
  for (;;) {
    const [existing] = await db
      .select({ id: collabChannel.id })
      .from(collabChannel)
      .where(and(eq(collabChannel.companyId, companyId), eq(collabChannel.slug, candidate)))
      .orderBy(asc(collabChannel.id))
      .limit(1);
    if (!existing) return candidate;
    suffix++;
    candidate = `${base}-${suffix}`;
  }
}
