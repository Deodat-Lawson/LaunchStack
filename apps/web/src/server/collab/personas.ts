/**
 * Agent personas: the roster a workspace draws its meeting participants — and
 * its chat agents — from.
 *
 * Personas are stored per company and *copied* into a meeting when it starts.
 * Editing a persona changes who shows up to the next meeting, never what was
 * said in a previous one. The same rows back the chat composer's agent picker
 * and `@handle` mentions, so an agent is one thing wherever it appears.
 */

import { and, asc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { AgentPersona } from "@launchstack/collab";
import { isAgentAutonomy, type AgentAutonomy } from "~/lib/agents/autonomy";
import {
    DEFAULT_AGENT_MODE,
    isAgentMode,
    isAgentRoute,
    isAgentStyle,
    normalizeToolPolicy,
    type AgentDefinition,
    type AgentMode,
    type AgentRouteId,
    type AgentStyleId,
    type AgentToolPolicy,
} from "~/lib/agents/definition";
import { STARTER_AGENTS } from "~/lib/agents/starter-agents";
import { collabAgentPersona } from "~/server/db/schema";
import { db } from "~/server/db";

type PersonaRow = typeof collabAgentPersona.$inferSelect;

export interface PersonaInput {
    key: string;
    displayName: string;
    role: string;
    systemPrompt: string;
    description?: string | null;
    mode?: AgentMode | null;
    tools?: AgentToolPolicy | null;
    style?: AgentStyleId | null;
    nodeId?: string | null;
    route?: AgentRouteId | null;
    /** 0–2, stored as an integer ×100 so the column stays exact. */
    temperature?: number | null;
    maxTurnChars?: number | null;
    accent?: string | null;
    /** Own autonomy level; null inherits the workspace default. */
    autonomy?: AgentAutonomy | null;
    builtin?: boolean;
}

/**
 * A roster row as the app sees it: the meeting engine's `AgentPersona` (so it
 * can be seated as-is) plus the harness fields and the storage identity.
 */
export interface PersonaRecord extends AgentPersona {
    dbId: string;
    archived: boolean;
    autonomy: AgentAutonomy | null;
    description: string;
    mode: AgentMode;
    tools: AgentToolPolicy | null;
    style: AgentStyleId | null;
    builtin: boolean;
}

export function rowToPersona(row: PersonaRow): PersonaRecord {
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
        autonomy: isAgentAutonomy(row.autonomy) ? row.autonomy : null,
        description: row.description ?? "",
        mode: isAgentMode(row.mode) ? row.mode : DEFAULT_AGENT_MODE,
        tools: normalizeToolPolicy(row.tools),
        style: isAgentStyle(row.style) ? row.style : null,
        builtin: row.builtin,
    };
}

/** The definition view of a row — what the file format and the chat resolver read. */
export function personaToDefinition(persona: PersonaRecord): AgentDefinition {
    return {
        key: persona.id,
        displayName: persona.displayName,
        role: persona.role,
        description: persona.description,
        systemPrompt: persona.systemPrompt,
        mode: persona.mode,
        tools: persona.tools,
        style: persona.style,
        route: isAgentRoute(persona.route) && persona.route !== "default" ? persona.route : null,
        temperature: persona.temperature ?? null,
        maxTurnChars: persona.maxTurnChars ?? null,
        accent: persona.accent ?? null,
        autonomy: persona.autonomy,
        nodeId: persona.nodeId ?? null,
    };
}

/** The frozen copy a meeting seats. Harness-only fields stay behind. */
export function personaToParticipant(persona: PersonaRecord): AgentPersona {
    return {
        id: persona.id,
        displayName: persona.displayName,
        role: persona.role,
        systemPrompt: persona.systemPrompt,
        nodeId: persona.nodeId,
        route: persona.route,
        temperature: persona.temperature,
        maxTurnChars: persona.maxTurnChars,
        accent: persona.accent,
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

export async function getPersonaById(companyId: bigint, personaDbId: string) {
    const [row] = await db
        .select()
        .from(collabAgentPersona)
        .where(
            and(eq(collabAgentPersona.companyId, companyId), eq(collabAgentPersona.id, personaDbId))
        )
        .limit(1);
    return row ? rowToPersona(row) : null;
}

function temperatureColumn(value: number | null | undefined): number | null {
    return value === null || value === undefined ? null : Math.round(value * 100);
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
            description: input.description ?? null,
            mode: input.mode ?? null,
            tools: input.tools ?? null,
            style: input.style ?? null,
            nodeId: input.nodeId ?? null,
            route: input.route ?? null,
            temperature: temperatureColumn(input.temperature),
            maxTurnChars: input.maxTurnChars ?? null,
            accent: input.accent ?? null,
            autonomy: input.autonomy ?? null,
            builtin: input.builtin ?? false,
        })
        .returning();
    if (!row) throw new Error("Failed to create persona");
    return rowToPersona(row);
}

export async function updatePersona(
    companyId: bigint,
    personaDbId: string,
    patch: Partial<PersonaInput> & { archived?: boolean }
) {
    const [row] = await db
        .update(collabAgentPersona)
        .set({
            ...(patch.key !== undefined ? { key: patch.key } : {}),
            ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
            ...(patch.role !== undefined ? { role: patch.role } : {}),
            ...(patch.systemPrompt !== undefined ? { systemPrompt: patch.systemPrompt } : {}),
            ...(patch.description !== undefined ? { description: patch.description } : {}),
            ...(patch.mode !== undefined ? { mode: patch.mode } : {}),
            ...(patch.tools !== undefined ? { tools: patch.tools } : {}),
            ...(patch.style !== undefined ? { style: patch.style } : {}),
            ...(patch.nodeId !== undefined ? { nodeId: patch.nodeId } : {}),
            ...(patch.route !== undefined ? { route: patch.route } : {}),
            ...(patch.temperature !== undefined
                ? { temperature: temperatureColumn(patch.temperature) }
                : {}),
            ...(patch.maxTurnChars !== undefined ? { maxTurnChars: patch.maxTurnChars } : {}),
            ...(patch.accent !== undefined ? { accent: patch.accent } : {}),
            ...(patch.autonomy !== undefined ? { autonomy: patch.autonomy } : {}),
            ...(patch.archived !== undefined ? { archived: patch.archived } : {}),
        })
        .where(
            and(eq(collabAgentPersona.companyId, companyId), eq(collabAgentPersona.id, personaDbId))
        )
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
        .where(
            and(eq(collabAgentPersona.companyId, companyId), eq(collabAgentPersona.id, personaDbId))
        )
        .returning();
    return row ? rowToPersona(row) : null;
}

/** An archived starter comes back when it is re-seeded; anything else stays retired. */
export async function unarchivePersona(companyId: bigint, personaDbId: string) {
    const [row] = await db
        .update(collabAgentPersona)
        .set({ archived: false })
        .where(
            and(eq(collabAgentPersona.companyId, companyId), eq(collabAgentPersona.id, personaDbId))
        )
        .returning();
    return row ? rowToPersona(row) : null;
}

function starterToInput(agent: (typeof STARTER_AGENTS)[number]): PersonaInput {
    return {
        key: agent.key,
        displayName: agent.displayName,
        role: agent.role,
        systemPrompt: agent.systemPrompt,
        description: agent.description,
        mode: agent.mode,
        tools: agent.tools,
        style: agent.style,
        route: agent.route,
        temperature: agent.temperature,
        maxTurnChars: agent.maxTurnChars,
        accent: agent.accent,
        autonomy: agent.autonomy,
        nodeId: agent.nodeId,
        builtin: true,
    };
}

/**
 * The roster a workspace starts with: the ten starter agents from
 * `~/lib/agents/starter-agents`. Kept as a named export because the API and
 * the tests refer to it by this name.
 */
export const STARTER_PERSONAS: PersonaInput[] = STARTER_AGENTS.map(starterToInput);

/**
 * Idempotently seeds the starter roster. A starter that already exists — under
 * any edits, archived or not — is left alone; only missing handles are added.
 * Returns the live roster.
 */
export async function ensureStarterPersonas(companyId: bigint) {
    const existing = await listPersonas(companyId, true);
    const have = new Set(existing.map(p => p.id));
    for (const persona of STARTER_PERSONAS) {
        if (have.has(persona.key)) continue;
        await createPersona(companyId, persona);
    }
    return listPersonas(companyId);
}

/**
 * Restores a starter agent to its shipped definition. Only the fields the
 * starter defines are rewritten; the node assignment is an operator choice
 * and survives.
 */
export async function resetStarterPersona(companyId: bigint, personaDbId: string) {
    const current = await getPersonaById(companyId, personaDbId);
    if (!current) return null;
    const starter = STARTER_AGENTS.find(agent => agent.key === current.id);
    if (!starter) return null;
    const input = starterToInput(starter);
    return updatePersona(companyId, personaDbId, {
        displayName: input.displayName,
        role: input.role,
        systemPrompt: input.systemPrompt,
        description: input.description,
        mode: input.mode,
        tools: input.tools,
        style: input.style,
        route: input.route,
        temperature: input.temperature,
        maxTurnChars: input.maxTurnChars,
        accent: input.accent,
        autonomy: input.autonomy,
        archived: false,
    });
}
