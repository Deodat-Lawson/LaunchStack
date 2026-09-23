/**
 * Request schemas for the agent roster — shared by the collection and item
 * routes so a create and an edit accept exactly the same fields.
 */

import { z } from "zod";

import { AGENT_AUTONOMY_LEVELS } from "~/lib/agents/autonomy";
import {
    AGENT_KEY_PATTERN,
    AGENT_MODES,
    AGENT_ROUTE_IDS,
    AGENT_STYLE_IDS,
    AGENT_TOOL_IDS,
} from "~/lib/agents/definition";

/** Persona handles are used as `@key` in transcripts, so keep them mention-safe. */
export const PersonaKeySchema = z
    .string()
    .min(2)
    .max(48)
    .regex(AGENT_KEY_PATTERN, "Use lowercase letters, digits, - and _");

const toolEntries = Object.fromEntries(
    AGENT_TOOL_IDS.map(id => [id, z.boolean().optional()])
) as Record<(typeof AGENT_TOOL_IDS)[number], z.ZodOptional<z.ZodBoolean>>;

export const ToolPolicySchema = z.object(toolEntries).strict().nullable();

export const PersonaFieldsSchema = z.object({
    key: PersonaKeySchema,
    displayName: z.string().min(1).max(80),
    role: z.string().min(1).max(80),
    systemPrompt: z.string().min(1).max(12_000),
    description: z.string().max(240).nullable().optional(),
    mode: z.enum(AGENT_MODES).nullable().optional(),
    tools: ToolPolicySchema.optional(),
    style: z.enum(AGENT_STYLE_IDS).nullable().optional(),
    nodeId: z.string().max(120).nullable().optional(),
    route: z.enum(AGENT_ROUTE_IDS).nullable().optional(),
    temperature: z.number().min(0).max(2).nullable().optional(),
    maxTurnChars: z.number().int().min(120).max(8000).nullable().optional(),
    accent: z.string().max(32).nullable().optional(),
    autonomy: z.enum(AGENT_AUTONOMY_LEVELS).nullable().optional(),
});

export const CreatePersonaSchema = PersonaFieldsSchema;
export const UpdatePersonaSchema = PersonaFieldsSchema.partial();

/** Import: a definition file, parsed server-side so the browser and the API agree. */
export const ImportPersonaSchema = z.object({
    file: z.string().min(1).max(40_000),
    /** Overwrite an existing agent with the same handle instead of refusing. */
    replace: z.boolean().optional(),
});
