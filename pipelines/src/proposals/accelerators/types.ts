import { z } from "zod";

import type { DraftMeta, RunKind, RunStatus, RunStep, RunSummary } from "../types";

export const FIELD_TYPES = [
    "long_text",
    "short_text",
    "url",
    "email",
    "number",
    "date",
    "select",
    "multi_select",
    "file",
    "video",
] as const;
export const FieldTypeSchema = z.enum(FIELD_TYPES);
export type FieldType = z.infer<typeof FieldTypeSchema>;

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

export const FormFieldSchema = z
    .object({
        key: IdSchema,
        position: z.number().int().nonnegative().max(2_147_483_647),
        question: z.string().trim().min(1),
        guidance: z.string().nullable(),
        fieldType: FieldTypeSchema,
        required: z.boolean(),
        options: z.array(z.object({ value: z.string().min(1), label: z.string().min(1) }).strict()),
        charLimit: z.number().int().positive().safe().nullable(),
        wordLimit: z.number().int().positive().max(2_147_483_647).nullable(),
        limitConfirmed: z.boolean(),
        limitSource: z
            .object({ url: HttpUrlSchema, quote: z.string().trim().min(1) })
            .strict()
            .nullable(),
    })
    .strict()
    .superRefine((field, ctx) => {
        const choices = field.fieldType === "select" || field.fieldType === "multi_select";
        if (choices !== field.options.length > 0) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["options"],
                message: choices
                    ? "Choice Fields require their actual options"
                    : "Only choice Fields have options",
            });
        }
        if (new Set(field.options.map(option => option.value)).size !== field.options.length) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["options"],
                message: "Option values must be unique",
            });
        }
        if (
            (field.charLimit !== null || field.wordLimit !== null) &&
            (!field.limitConfirmed || !field.limitSource)
        ) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["limitSource"],
                message: "A numeric limit requires confirmed source evidence",
            });
        }
    });
export type FormField = z.infer<typeof FormFieldSchema>;

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

export const ProgramFormSchema = z
    .object({
        id: IdSchema,
        status: z.enum(["checked", "unconfirmed", "unavailable"]),
        sourceUrl: HttpUrlSchema,
        checkedAt: IsoDateTimeSchema.nullable(),
        supported: z.boolean(),
        limitations: z.array(z.string().trim().min(1)),
        fields: z.array(FormFieldSchema),
    })
    .strict()
    .superRefine((form, ctx) => {
        if (form.status === "checked" && form.checkedAt === null) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["checkedAt"],
                message: "A checked Form needs its review timestamp",
            });
        }
        if ((!form.supported || form.status === "unavailable") && form.limitations.length === 0) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["limitations"],
                message: "Explain why this Form cannot be started",
            });
        }
        for (const key of ["key", "position"] as const) {
            if (new Set(form.fields.map(field => field[key])).size !== form.fields.length) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ["fields"],
                    message: `Field ${key}s must be unique`,
                });
            }
        }
    });
export type ProgramForm = z.infer<typeof ProgramFormSchema>;

export const ProgramCycleSchema = z
    .object({
        id: IdSchema,
        label: z.string().trim().min(1),
        deadlineAt: IsoDateTimeSchema.nullable(),
        deadlineTimezone: TimezoneSchema.nullable(),
        dateOnly: DateOnlySchema.optional(),
        rolling: z.boolean(),
        sourceIds: z.array(IdSchema),
        form: ProgramFormSchema,
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

export const FitAssessmentSchema = z
    .object({
        score: z.number().int().min(0).max(100).nullable(),
        reasons: z.array(z.string()),
        concerns: z.array(z.string()),
        unknowns: z.array(z.string()),
        sourceIds: z.array(IdSchema),
        companyEvidenceIds: z.array(z.number().int().positive()),
    })
    .strict();
export type FitAssessment = z.infer<typeof FitAssessmentSchema>;

export interface StoredFit {
    assessment: FitAssessment;
    profileHash: string;
    programHash: string;
    checkedAt: string;
}
export interface ProgramView {
    program: CatalogueProgram;
    contentHash: string;
    fit: StoredFit | null;
    fitStale: boolean;
}
export interface AcceleratorSection {
    id: string;
    key: string;
    field: FormField;
    draft: string | null;
    revision: number;
    draftMeta: DraftMeta | null;
}
export interface AcceleratorApplication {
    id: string;
    title: string;
    programId: string;
    cycleId: string;
    formHash: string;
    sections: AcceleratorSection[];
}
export interface HomeResponse {
    programs: ProgramView[];
    applications: AcceleratorApplication[];
    profileReady: boolean;
    canEdit: boolean;
    costs: { match: number; draft: number; edit: number };
}
export interface RunView {
    id: string;
    kind: RunKind;
    status: RunStatus;
    steps: RunStep[];
    summary: RunSummary | null;
    error: string | null;
    creditsUsed: number;
    createdAt: string;
    startedAt: string | null;
    completedAt: string | null;
}

export const AnswerPatchSchema = z
    .object({
        expectedRevision: z.number().int().nonnegative(),
        draft: z.string().nullable(),
    })
    .strict();
export type AnswerPatch = z.infer<typeof AnswerPatchSchema>;
const SelectionShape = {
    expectedRevision: z.number().int().nonnegative(),
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
};

/** `original` is the text the Suggestion replaces; Apply refuses if the saved slice differs. */
export const ApplyEditSchema = z
    .object({ ...SelectionShape, original: z.string().min(1), replacement: z.string() })
    .strict()
    .refine(value => value.end > value.start, {
        message: "Select a non-empty original range",
        path: ["end"],
    })
    .refine(value => value.end - value.start === value.original.length, {
        message: "Original text must match the UTF-16 selection length",
        path: ["original"],
    });
export type ApplyEdit = z.infer<typeof ApplyEditSchema>;

/** IDs belong in the Application/Field route; tenancy is always resolved by the server. */
export const EditSuggestionRequestSchema = z
    .object({ ...SelectionShape, instruction: z.string().trim().min(1) })
    .strict()
    .refine(value => value.end > value.start, {
        message: "Select a non-empty original range",
        path: ["end"],
    });
export type EditSuggestionRequest = z.infer<typeof EditSuggestionRequestSchema>;

/** B attaches the validated selection to its generated preview, without saving an answer. */
export const EditSuggestionSchema = z
    .object({
        ...SelectionShape,
        original: z.string().min(1),
        replacement: z.string(),
        gaps: z.array(z.string()),
    })
    .strict()
    .refine(value => value.end - value.start === value.original.length, {
        message: "Original text must match the UTF-16 selection length",
        path: ["original"],
    });
export type EditSuggestion = z.infer<typeof EditSuggestionSchema>;

export class AcceleratorError extends Error {
    constructor(
        message: string,
        public readonly status: 400 | 404 | 409,
        public readonly code: string
    ) {
        super(message);
        this.name = "AcceleratorError";
    }
}

/** A required Field may be saved incomplete; required is a submission requirement. */
export function assertAnswer(field: FormField, draft: string | null): void {
    if (draft === null || draft === "") return;
    if (field.fieldType === "file" || field.fieldType === "video") {
        throw new AcceleratorError(
            "File and video requirements must be completed in the Program's portal",
            400,
            "manual_requirement"
        );
    }
    if (field.charLimit !== null && draft.length > field.charLimit) {
        throw new AcceleratorError(
            `Answer exceeds the ${field.charLimit} character limit`,
            400,
            "character_limit"
        );
    }
    if (
        field.wordLimit !== null &&
        draft.trim().split(/\s+/u).filter(Boolean).length > field.wordLimit
    ) {
        throw new AcceleratorError(
            `Answer exceeds the ${field.wordLimit} word limit`,
            400,
            "word_limit"
        );
    }
    let valid = true;
    switch (field.fieldType) {
        case "url":
            valid = HttpUrlSchema.safeParse(draft).success;
            break;
        case "email":
            valid = z.string().email().safeParse(draft).success;
            break;
        case "number":
            valid =
                /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(draft) &&
                Number.isFinite(Number(draft));
            break;
        case "date":
            valid = DateOnlySchema.safeParse(draft).success;
            break;
        case "select":
            valid = field.options.some(option => option.value === draft);
            break;
        case "multi_select": {
            try {
                const values: unknown = JSON.parse(draft);
                valid =
                    Array.isArray(values) &&
                    values.every(
                        value =>
                            typeof value === "string" &&
                            field.options.some(option => option.value === value)
                    ) &&
                    new Set(values).size === values.length;
            } catch {
                valid = false;
            }
            break;
        }
        case "short_text":
            valid = !/[\r\n]/.test(draft);
            break;
    }
    if (!valid)
        throw new AcceleratorError(
            `Answer is not a valid ${field.fieldType} value`,
            400,
            "invalid_answer"
        );
}

export function canStartForm(form: ProgramForm): boolean {
    return (
        form.status === "checked" &&
        form.supported &&
        form.checkedAt !== null &&
        form.fields.length > 0
    );
}
