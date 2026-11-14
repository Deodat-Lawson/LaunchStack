import { z } from "zod";

const roleText = z.string().trim().min(1).max(160);
export const BusinessRoleInputSchema = z
    .object({
        primaryRole: z.string().trim().min(1).max(80),
        responsibilities: z.array(roleText).max(8),
        priorities: z.array(roleText).max(8),
        confirmed: z.literal(true),
    })
    .strict();

export const BusinessRoleContextSchema = BusinessRoleInputSchema.extend({
    schemaVersion: z.literal("vantage-business-role/v1"),
    confirmedBy: z.string().min(1),
    companyId: z.string().regex(/^[1-9]\d*$/),
    revision: z.number().int().positive(),
});

export type BusinessRoleContext = z.infer<typeof BusinessRoleContextSchema>;
export type BusinessRoleInput = z.infer<typeof BusinessRoleInputSchema>;

export function parseConfirmedBusinessRole(
    raw: unknown,
    actor: { companyId: string; userId: string }
): BusinessRoleContext | undefined {
    const parsed = BusinessRoleContextSchema.safeParse(raw);
    if (
        !parsed.success ||
        parsed.data.companyId !== actor.companyId ||
        parsed.data.confirmedBy !== actor.userId
    )
        return undefined;
    return parsed.data;
}
