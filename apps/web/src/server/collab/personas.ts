/**
 * Agent personas: the roster a workspace draws its meeting participants from.
 *
 * Personas are stored per company and *copied* into a meeting when it starts.
 * Editing a persona changes who shows up to the next meeting, never what was
 * said in a previous one.
 */

import { and, asc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { AgentPersona } from "@launchstack/core/collab";
import { collabAgentPersona } from "~/server/db/schema";
import { db } from "~/server/db";

type PersonaRow = typeof collabAgentPersona.$inferSelect;

export interface PersonaInput {
  key: string;
  displayName: string;
  role: string;
  systemPrompt: string;
  nodeId?: string | null;
  route?: string | null;
  /** 0–2, stored as an integer ×100 so the column stays exact. */
  temperature?: number | null;
  maxTurnChars?: number | null;
  accent?: string | null;
}

export function rowToPersona(row: PersonaRow): AgentPersona & { dbId: string; archived: boolean } {
  return {
    dbId: row.id,
    id: row.key,
    displayName: row.displayName,
    role: row.role,
    systemPrompt: row.systemPrompt,
    nodeId: row.nodeId ?? undefined,
    route: row.route ?? undefined,
    temperature: row.temperature === null ? undefined : row.temperature / 100,
    maxTurnChars: row.maxTurnChars ?? undefined,
    accent: row.accent ?? undefined,
    archived: row.archived,
  };
}

export async function listPersonas(companyId: bigint, includeArchived = false) {
  const conditions = [eq(collabAgentPersona.companyId, companyId)];
  if (!includeArchived) conditions.push(eq(collabAgentPersona.archived, false));
  const rows = await db
    .select()
    .from(collabAgentPersona)
    .where(and(...conditions))
    .orderBy(asc(collabAgentPersona.createdAt));
  return rows.map(rowToPersona);
}

export async function getPersonaByKey(companyId: bigint, key: string) {
  const [row] = await db
    .select()
    .from(collabAgentPersona)
    .where(and(eq(collabAgentPersona.companyId, companyId), eq(collabAgentPersona.key, key)))
    .limit(1);
  return row ? rowToPersona(row) : null;
}

export async function createPersona(companyId: bigint, input: PersonaInput) {
  const [row] = await db
    .insert(collabAgentPersona)
    .values({
      id: `persona_${randomUUID().replace(/-/g, "")}`,
      companyId,
      key: input.key,
      displayName: input.displayName,
      role: input.role,
      systemPrompt: input.systemPrompt,
      nodeId: input.nodeId ?? null,
      route: input.route ?? null,
      temperature: input.temperature === null || input.temperature === undefined
        ? null
        : Math.round(input.temperature * 100),
      maxTurnChars: input.maxTurnChars ?? null,
      accent: input.accent ?? null,
    })
    .returning();
  if (!row) throw new Error("Failed to create persona");
  return rowToPersona(row);
}

export async function updatePersona(companyId: bigint, personaDbId: string, patch: Partial<PersonaInput>) {
  const [row] = await db
    .update(collabAgentPersona)
    .set({
      ...(patch.key !== undefined ? { key: patch.key } : {}),
      ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
      ...(patch.role !== undefined ? { role: patch.role } : {}),
      ...(patch.systemPrompt !== undefined ? { systemPrompt: patch.systemPrompt } : {}),
      ...(patch.nodeId !== undefined ? { nodeId: patch.nodeId } : {}),
      ...(patch.route !== undefined ? { route: patch.route } : {}),
      ...(patch.temperature !== undefined
        ? { temperature: patch.temperature === null ? null : Math.round(patch.temperature * 100) }
        : {}),
      ...(patch.maxTurnChars !== undefined ? { maxTurnChars: patch.maxTurnChars } : {}),
      ...(patch.accent !== undefined ? { accent: patch.accent } : {}),
    })
    .where(and(eq(collabAgentPersona.companyId, companyId), eq(collabAgentPersona.id, personaDbId)))
    .returning();
  return row ? rowToPersona(row) : null;
}

/**
 * Archives rather than deletes. A persona id appears in past transcripts and
 * in frozen meeting participant lists; removing the row would orphan them.
 */
export async function archivePersona(companyId: bigint, personaDbId: string) {
  const [row] = await db
    .update(collabAgentPersona)
    .set({ archived: true })
    .where(and(eq(collabAgentPersona.companyId, companyId), eq(collabAgentPersona.id, personaDbId)))
    .returning();
  return row ? rowToPersona(row) : null;
}

/**
 * The roster a workspace starts with. Chosen to be immediately useful for a
 * document-heavy product: someone who drives, someone who checks feasibility,
 * someone who checks the numbers, and someone who reads the fine print.
 */
export const STARTER_PERSONAS: PersonaInput[] = [
  {
    key: "facilitator",
    displayName: "Ada",
    role: "Facilitator",
    systemPrompt:
      "You run the meeting. Open with the objective, keep the agenda moving, ask a named participant when a point needs an owner, and close once the objective is met. Never answer a question you should be routing to a specialist.",
    accent: "oklch(0.55 0.14 250)",
  },
  {
    key: "analyst",
    displayName: "Ravi",
    role: "Analyst",
    systemPrompt:
      "You reason from the documents in the workspace. Quote figures and clause references when they exist, and say plainly when the sources do not support a claim rather than filling the gap.",
    accent: "oklch(0.58 0.15 165)",
  },
  {
    key: "engineer",
    displayName: "Sam",
    role: "Engineering lead",
    systemPrompt:
      "You judge feasibility and cost of delivery. Give estimates in sprints, name the long pole, and flag anything that would need a migration or a rollback plan.",
    accent: "oklch(0.55 0.14 225)",
  },
  {
    key: "counsel",
    displayName: "Mira",
    role: "Risk & compliance",
    systemPrompt:
      "You read for exposure: missing exhibits, unclear obligations, retention and privacy requirements. Be specific about which clause or control creates the risk. You are not giving legal advice.",
    accent: "oklch(0.6 0.17 50)",
  },
];

/** Idempotently seeds the starter roster. Returns the full roster. */
export async function ensureStarterPersonas(companyId: bigint) {
  const existing = await listPersonas(companyId, true);
  const have = new Set(existing.map((p) => p.id));
  for (const persona of STARTER_PERSONAS) {
    if (have.has(persona.key)) continue;
    await createPersona(companyId, persona);
  }
  return listPersonas(companyId);
}

export interface ApplyPersonasResult {
  created: string[];
  /** Handles already in use — left exactly as they were. */
  skipped: string[];
}

/**
 * Splits a candidate roster into what would be created and what already
 * exists. Pure, and separate from the writes, because this is the rule worth
 * testing: which handles are considered taken.
 */
export function partitionByHandle(
  existingKeys: Iterable<string>,
  candidates: PersonaInput[],
): { toCreate: PersonaInput[]; skipped: string[] } {
  const taken = new Set(existingKeys);
  const toCreate: PersonaInput[] = [];
  const skipped: string[] = [];

  for (const candidate of candidates) {
    if (taken.has(candidate.key)) {
      skipped.push(candidate.key);
      continue;
    }
    // Added as we go, so a pack that lists the same handle twice creates it
    // once rather than tripping the unique index on the second insert.
    taken.add(candidate.key);
    toCreate.push(candidate);
  }
  return { toCreate, skipped };
}

/**
 * Adds a set of personas to a workspace, additively.
 *
 * An existing handle is never overwritten. A persona key is referenced by past
 * transcripts and by the frozen participant list on every meeting that used
 * it, so silently replacing `@eng` because a preset also defines `@eng` would
 * rewrite the meaning of history. The caller is told what was skipped and can
 * offer to rename.
 *
 * Archived personas count as taken: their handle is still live in old
 * transcripts, and the unique index is on `(company_id, key)` regardless.
 */
export async function applyPersonas(
  companyId: bigint,
  personas: PersonaInput[],
): Promise<ApplyPersonasResult> {
  const existing = await listPersonas(companyId, true);
  const { toCreate, skipped } = partitionByHandle(
    existing.map((p) => p.id),
    personas,
  );

  const created: string[] = [];
  for (const persona of toCreate) {
    await createPersona(companyId, persona);
    created.push(persona.key);
  }
  return { created, skipped };
}
