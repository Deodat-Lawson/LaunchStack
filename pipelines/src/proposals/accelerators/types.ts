import { z } from "zod";

const IdSchema = z.string().trim().min(1).max(64);
const HttpUrlSchema = z
    .string()
    .url()
    .refine(value => /^https?:\/\//i.test(value), {
        message: "Use a public HTTP or HTTPS URL",
    });
const IsoDateTimeSchema = z.string().datetime({ offset: true });
const DateOnlySchema = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(value => {
        const date = new Date(`${value}T00:00:00Z`);
        return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
    }, "Use a real calendar date (YYYY-MM-DD)");
const TimezoneSchema = z
    .string()
    .min(1)
    .refine(value => {
        try {
            new Intl.DateTimeFormat("en", { timeZone: value });
            return true;
        } catch {
            return false;
        }
    }, "Use a valid IANA timezone");

export const ProgramSourceSchema = z
    .object({
        id: IdSchema,
        url: HttpUrlSchema,
        title: z.string().trim().min(1),
        quote: z.string().trim().min(1),
        checkedAt: IsoDateTimeSchema,
    })
    .strict();
export type ProgramSource = z.infer<typeof ProgramSourceSchema>;

export const SourcedNarrativeSchema = z
    .object({
        text: z.string().trim().min(1),
        sourceIds: z.array(IdSchema).min(1),
        interpretation: z.boolean(),
    })
    .strict();
export type SourcedNarrative = z.infer<typeof SourcedNarrativeSchema>;

export const ProgramCycleSchema = z
    .object({
        id: IdSchema,
        label: z.string().trim().min(1),
        deadlineAt: IsoDateTimeSchema.nullable(),
        deadlineTimezone: TimezoneSchema.nullable(),
        dateOnly: DateOnlySchema.optional(),
        rolling: z.boolean(),
        sourceIds: z.array(IdSchema),
    })
    .strict()
    .superRefine((cycle, ctx) => {
        if (
            (cycle.deadlineAt !== null || cycle.dateOnly !== undefined) &&
            cycle.sourceIds.length === 0
        ) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["sourceIds"],
                message: "An exact deadline requires supporting sources",
            });
        }
        if (cycle.deadlineAt !== null && cycle.deadlineTimezone === null) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["deadlineTimezone"],
                message: "An exact deadline requires its timezone",
            });
        }
        if (cycle.deadlineAt !== null && cycle.dateOnly !== undefined) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["dateOnly"],
                message: "Use dateOnly only when no exact deadline time is known",
            });
        }
    });
export type ProgramCycle = z.infer<typeof ProgramCycleSchema>;

export const ProgramLogoSchema = z
    .object({
        path: z
            .string()
            .regex(
                /^\/accelerators\/logos\/[a-z0-9][a-z0-9._-]*\.(?:png|webp|jpe?g|svg)$/i,
                "Use a versioned local logo asset under /accelerators/logos/"
            ),
        sourceId: IdSchema,
    })
    .strict();
export type ProgramLogo = z.infer<typeof ProgramLogoSchema>;

export const CatalogueProgramSchema = z
    .object({
        schemaVersion: z.literal(2),
        id: IdSchema,
        name: z.string().trim().min(1).max(256),
        logo: ProgramLogoSchema,
        websiteUrl: HttpUrlSchema,
        applyUrl: HttpUrlSchema,
        description: SourcedNarrativeSchema,
        targetApplicants: SourcedNarrativeSchema,
        location: SourcedNarrativeSchema.optional(),
        sources: z.array(ProgramSourceSchema).min(1),
        cycles: z.array(ProgramCycleSchema),
    })
    .strict()
    .superRefine((program, ctx) => {
        const sources = new Set(program.sources.map(source => source.id));
        if (sources.size !== program.sources.length) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["sources"],
                message: "Source IDs must be unique",
            });
        }
        if (new Set(program.cycles.map(cycle => cycle.id)).size !== program.cycles.length) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["cycles"],
                message: "Cycle IDs must be unique within a Program",
            });
        }
        const references: { ids: string[]; path: (string | number)[] }[] = [
            { ids: [program.logo.sourceId], path: ["logo", "sourceId"] },
            { ids: program.description.sourceIds, path: ["description", "sourceIds"] },
            { ids: program.targetApplicants.sourceIds, path: ["targetApplicants", "sourceIds"] },
            ...(program.location
                ? [{ ids: program.location.sourceIds, path: ["location", "sourceIds"] }]
                : []),
            ...program.cycles.map((cycle, index) => ({
                ids: cycle.sourceIds,
                path: ["cycles", index, "sourceIds"],
            })),
        ];
        for (const reference of references) {
            if (
                new Set(reference.ids).size !== reference.ids.length ||
                reference.ids.some(id => !sources.has(id))
            ) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: reference.path,
                    message: "Source references must be unique IDs present in this Program",
                });
            }
        }
    });
export type CatalogueProgram = z.infer<typeof CatalogueProgramSchema>;
