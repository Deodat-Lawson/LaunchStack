import {
    EXTRACTION_LIMITS,
    type CreateExtractionFieldInput,
    type ExtractionFieldType,
} from "~/lib/extraction/types";

/**
 * The fields editor as plain functions: a row being typed, what is wrong
 * with it, what goes to the server, and the starter sets. Pinned by a unit
 * test. Words are message keys (`extract.new.starters.*`,
 * `extract.new.problems.*`), worded where they render.
 */

/** One row of the editor. `key` is the row's own, for React and for problems. */
export interface FieldDraft {
    key: string;
    name: string;
    type: ExtractionFieldType;
    instruction: string;
}

let nextKey = 1;

export function blankField(type: ExtractionFieldType = "text"): FieldDraft {
    return { key: `row${nextKey++}`, name: "", type, instruction: "" };
}

export type FieldProblem = "empty" | "duplicate" | "nameTooLong" | "instructionTooLong";

const normal = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * What is wrong with each row, by row key; a row with nothing wrong has no
 * entry. Two names that differ only by case or spacing are the same column
 * to a reader, so both rows are marked.
 */
export function fieldProblems(drafts: readonly FieldDraft[]): Record<string, FieldProblem> {
    const seen = new Map<string, number>();
    for (const draft of drafts) {
        const name = normal(draft.name);
        if (name) seen.set(name, (seen.get(name) ?? 0) + 1);
    }
    const problems: Record<string, FieldProblem> = {};
    for (const draft of drafts) {
        const name = normal(draft.name);
        if (!name) problems[draft.key] = "empty";
        else if ((seen.get(name) ?? 0) > 1) problems[draft.key] = "duplicate";
        else if (draft.name.trim().length > EXTRACTION_LIMITS.fieldNameLength)
            problems[draft.key] = "nameTooLong";
        else if (draft.instruction.trim().length > EXTRACTION_LIMITS.instructionLength)
            problems[draft.key] = "instructionTooLong";
    }
    return problems;
}

/** Nothing typed anywhere: a starter set can replace it without asking. */
export function isUntouched(drafts: readonly FieldDraft[]): boolean {
    return drafts.every(d => !d.name.trim() && !d.instruction.trim());
}

/** The rows as the server takes them: trimmed, an empty instruction left out. */
export function toFieldInputs(drafts: readonly FieldDraft[]): CreateExtractionFieldInput[] {
    return drafts.map(draft => {
        const instruction = draft.instruction.trim();
        return {
            name: draft.name.trim().replace(/\s+/g, " "),
            type: draft.type,
            ...(instruction ? { instruction } : {}),
        };
    });
}

/** Moves the row at `index` one place up (-1) or down (1); out of range changes nothing. */
export function moveField<T>(rows: readonly T[], index: number, delta: -1 | 1): T[] {
    const to = index + delta;
    if (index < 0 || index >= rows.length || to < 0 || to >= rows.length) return [...rows];
    const next = [...rows];
    const [row] = next.splice(index, 1);
    next.splice(to, 0, row!);
    return next;
}

/**
 * Fields to start from. `id` and each field's `key` name the messages:
 * `extract.new.starters.<id>` (the set), `extract.new.starterFields.<key>`
 * (a column's name) and, for the keys in `STARTER_HINTS`,
 * `extract.new.starterHints.<key>` (what to look for).
 */
export const STARTER_SETS = [
    {
        id: "invoice",
        fields: [
            { key: "vendor", type: "text" },
            { key: "invoiceNumber", type: "text" },
            { key: "invoiceDate", type: "date" },
            { key: "totalAmount", type: "number" },
            { key: "currency", type: "text" },
        ],
    },
    {
        id: "contract",
        fields: [
            { key: "parties", type: "list" },
            { key: "effectiveDate", type: "date" },
            { key: "term", type: "text" },
            { key: "governingLaw", type: "text" },
            { key: "terminationNotice", type: "text" },
        ],
    },
    {
        id: "resume",
        fields: [
            { key: "name", type: "text" },
            { key: "email", type: "text" },
            { key: "currentRole", type: "text" },
            { key: "yearsOfExperience", type: "number" },
            { key: "skills", type: "list" },
        ],
    },
] as const satisfies readonly {
    id: string;
    fields: readonly { key: string; type: ExtractionFieldType }[];
}[];

export type StarterSet = (typeof STARTER_SETS)[number];
export type StarterSetId = StarterSet["id"];
export type StarterFieldKey = StarterSet["fields"][number]["key"];

/** Starter fields whose name alone leaves room for doubt, so they come with what to look for. */
export const STARTER_HINTS = [
    "totalAmount",
    "currency",
    "terminationNotice",
    "yearsOfExperience",
] as const satisfies readonly StarterFieldKey[];

export type StarterHintKey = (typeof STARTER_HINTS)[number];

export function starterHintKey(key: StarterFieldKey): StarterHintKey | null {
    return (STARTER_HINTS as readonly string[]).includes(key) ? (key as StarterHintKey) : null;
}
