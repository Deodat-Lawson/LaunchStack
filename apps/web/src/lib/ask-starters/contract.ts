/**
 * The wire contract for the workspace's starter questions — the four cards on
 * the Ask panel's empty state.
 *
 * Shared by the server (which generates them) and the workspace client (which
 * renders and sends them), so it must stay free of server-only imports.
 */

import { z } from "zod";

export const ASK_STARTER_COUNT = 4;
export const ASK_STARTER_QUESTION_MAX_CHARS = 120;
export const ASK_STARTER_HINT_MAX_CHARS = 64;
/** A starter may pin at most this many documents when it is sent. */
export const ASK_STARTER_MAX_DOCUMENTS = 2;

export interface AskStarter {
    id: string;
    question: string;
    /** 3–7 words on where the answer will come from. */
    hint: string;
    /** Documents the question is about. The client pins them as sources on send. */
    documentIds: number[];
}

export interface AskStartersBasis {
    companyName: string | null;
    sourceCount: number;
    /** An extracted company profile informed the questions. */
    hasProfile: boolean;
    /** `generated` came from the model; `fallback` is the deterministic set. */
    mode: "generated" | "fallback";
    generatedAt: string;
}

export interface AskStartersPayload {
    starters: AskStarter[];
    basis: AskStartersBasis;
}

/**
 * What the model is asked to return. Deliberately looser than the wire shape:
 * the server shapes, validates and pads it, so a model that returns five or
 * three questions still produces a usable set instead of a schema failure.
 *
 * Every field is required. Endpoints that enforce the schema natively
 * (OpenAI-compatible json-schema mode) reject `.optional()` outright, and the
 * error surfaces as a failed call — a broad question carries an empty array.
 */
export const GeneratedStartersSchema = z.object({
    starters: z
        .array(
            z.object({
                question: z.string(),
                hint: z.string(),
                documentIds: z.array(z.number().int()),
            })
        )
        .min(1)
        .max(8),
});

export type GeneratedStarters = z.infer<typeof GeneratedStartersSchema>;
