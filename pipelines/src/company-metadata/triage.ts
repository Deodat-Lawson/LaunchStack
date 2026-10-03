/**
 * Sorting sources — is this document about the organisation?
 *
 * A workspace holds the organisation's own material next to other people's:
 * research papers, articles, templates, test mindmaps. Only the first kind
 * may speak for the organisation, so every source version gets a role
 * before any fact is read from it:
 *
 *   - rules first (pure): nothing readable left after cleaning → no_content;
 *   - otherwise one small model call over the opening passages, judged on
 *     voice and authorship, not on whether the name appears.
 *
 * The role and its one-sentence reason are shown to the person, who can
 * override either way.
 */
import { z } from "zod";

import type { GenerateStructuredFn } from "./extractor";
import type { CleanResult, DropReason } from "./passages";
import { TRIAGE_SYSTEM_PROMPT, buildTriagePrompt } from "./prompts";
import { SOURCE_ROLE_VALUES, type SourceRole } from "./types";

/** Where a document came from, as far as its row says. */
export type SourceKind =
    | "upload"
    | "website"
    | "mindmap"
    | "google-drive"
    | "gmail"
    | "conversation"
    | "artifact"
    | "other";

export interface TriageInput {
    companyName: string;
    /** What is already known: description, industry, website. */
    known: string[];
    title: string;
    folder: string;
    kind: SourceKind;
    cleaned: CleanResult;
}

export interface TriageResult {
    role: SourceRole;
    roleBy: "rules" | "model";
    reason: string;
}

/** Letters of clean text below which a source has nothing to say. */
export const MIN_READABLE_LETTERS = 120;

/** Opening text the model judges from. */
const OPENING_CHARS = 5_000;
const MIDDLE_SAMPLE_CHARS = 1_200;

const DROP_WORDS: Record<DropReason, string> = {
    references: "reference lists",
    table: "number tables",
    figure: "chart residue",
    boilerplate: "boilerplate",
    placeholder: "empty placeholders",
    too_short: "fragments",
    duplicate: "repeated text",
};

/** The source kind from the provenance markers ingestion leaves on a document row. */
export function sourceKindOf(doc: {
    creationKey: string | null;
    ocrMetadata: unknown;
    mimeType?: string | null;
}): SourceKind {
    const meta =
        doc.ocrMetadata && typeof doc.ocrMetadata === "object"
            ? (doc.ocrMetadata as Record<string, unknown>)
            : {};
    const key = doc.creationKey ?? "";
    if (meta.kind === "mindmap" || key.startsWith("mindmap:")) return "mindmap";
    if (meta.kind === "claude-artifact") return "artifact";
    if (meta.connector === "agent-sessions" || meta.connector === "agent-knowledge")
        return "conversation";
    if (meta.connector === "gmail" || key.startsWith("connector:gmail:")) return "gmail";
    if (
        meta.connector === "google-drive" ||
        key.startsWith("connector:google-drive:") ||
        key.startsWith("gdrive:") ||
        key.startsWith("gdocs:")
    )
        return "google-drive";
    if (key.startsWith("website:") || key.startsWith("crawl:")) return "website";
    if (key.startsWith("upload:") || key.startsWith("batch:")) return "upload";
    return "other";
}

function letters(text: string): number {
    return (text.match(/\p{L}/gu) ?? []).length;
}

/** "reference lists and number tables" — the two biggest reasons text was dropped. */
function droppedPhrase(cleaned: CleanResult, ignore: DropReason[] = []): string {
    const top = Object.entries(cleaned.dropped)
        .filter(([reason, n]) => n > 0 && !ignore.includes(reason as DropReason))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([reason]) => DROP_WORDS[reason as DropReason] ?? reason);
    return top.join(" and ");
}

/** A decision the rules can make without a model, or null to ask one. */
export function triageByRules(input: TriageInput): TriageResult | null {
    const { cleaned } = input;
    if (cleaned.total === 0)
        return { role: "no_content", roleBy: "rules", reason: "No readable text in this file." };
    const readable = cleaned.passages.reduce((n, p) => n + letters(p.text), 0);
    if (readable >= MIN_READABLE_LETTERS) return null;
    if (input.kind === "mindmap")
        return {
            role: "no_content",
            roleBy: "rules",
            reason: "A mindmap with only a few words on it.",
        };
    // Everything was noise: say which kind, so "set aside" is never a mystery.
    const noise = droppedPhrase(cleaned, ["too_short", "placeholder"]);
    return {
        role: "no_content",
        roleBy: "rules",
        reason: noise
            ? `Only ${noise} — nothing about the organisation to read.`
            : "Too little text to say anything about the organisation.",
    };
}

/** The opening passages, plus a sample from the middle when the document runs on. */
export function openingOf(cleaned: CleanResult): string {
    const parts: string[] = [];
    let size = 0;
    let used = 0;
    for (const passage of cleaned.passages) {
        if (size >= OPENING_CHARS) break;
        const room = OPENING_CHARS - size;
        const text = passage.text.length > room ? `${passage.text.slice(0, room)}…` : passage.text;
        parts.push(text);
        size += text.length;
        used++;
    }
    const rest = cleaned.passages.slice(used);
    if (rest.length > 0) {
        const middle = rest[Math.floor(rest.length / 2)]!.text;
        parts.push(
            `[… later in the document …]\n${middle.length > MIDDLE_SAMPLE_CHARS ? `${middle.slice(0, MIDDLE_SAMPLE_CHARS)}…` : middle}`
        );
    }
    return parts.join("\n\n");
}

const TriageSchema = z.object({
    role: z.enum(SOURCE_ROLE_VALUES),
    reason: z.string(),
    subject: z.string(),
});

export async function triageByModel(
    input: TriageInput,
    generate: GenerateStructuredFn
): Promise<TriageResult> {
    const result = await generate({
        system: TRIAGE_SYSTEM_PROMPT,
        prompt: buildTriagePrompt({
            companyName: input.companyName,
            known: input.known,
            title: input.title,
            folder: input.folder,
            kind: input.kind,
            opening: openingOf(input.cleaned),
        }),
        schema: TriageSchema,
        schemaName: "source_role",
    });
    const reason = result.reason.trim().replace(/\s+/g, " ");
    return {
        role: result.role,
        roleBy: "model",
        reason:
            reason.length > 240 ? `${reason.slice(0, 239)}…` : reason || defaultReason(result.role),
    };
}

function defaultReason(role: SourceRole): string {
    return role === "about_us"
        ? "Written by or about the organisation."
        : role === "third_party"
          ? "Someone else's material, kept for reference."
          : "Nothing to read.";
}

export async function triageSource(
    input: TriageInput,
    generate: GenerateStructuredFn
): Promise<TriageResult> {
    return triageByRules(input) ?? triageByModel(input, generate);
}
