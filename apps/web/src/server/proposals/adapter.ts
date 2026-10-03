/**
 * Proposals records → the DTOs the screens read. Pure: given records and a
 * clock, returns JSON shapes. Everything that touches the database lives in
 * ./service; everything here is testable without one.
 */
import type {
    ApplicationRecord,
    Evidence,
    LibraryItemRecord,
    OpportunityRecord,
    RunRecord,
    SectionRecord,
} from "@launchstack/pipelines/proposals/types";
import { daysUntil, wordCount } from "@launchstack/pipelines/proposals";

import type {
    ApplicationDetail,
    ApplicationRow,
    EvidenceDto,
    FunderRow,
    LibraryItemDto,
    RunDto,
    SectionDto,
    TodoItem,
} from "~/app/employer/tools/proposals/api";

export function sourceHref(documentId: number | null): string | null {
    return documentId === null ? null : `/employer/documents?source=d${documentId}`;
}

export function toEvidenceDto(evidence: Evidence): EvidenceDto {
    return { ...evidence, href: evidence.url ? null : sourceHref(evidence.documentId) };
}

export function toFunderRow(
    record: OpportunityRecord,
    options: { now: Date; applicationId?: string | null }
): FunderRow {
    return {
        id: record.id,
        source: record.source,
        title: record.title,
        funder: record.funder,
        url: record.url,
        summary: record.summary,
        closesOn: record.closesOn,
        daysLeft: daysUntil(record.closesOn, options.now),
        status: record.status,
        amountMin: record.amountMin,
        amountMax: record.amountMax,
        eligibility: record.eligibility,
        fit: record.fit?.score ?? null,
        why: record.fit?.why ?? [],
        concerns: record.fit?.concerns ?? [],
        applicationId: options.applicationId ?? null,
        foundAt: (record.updatedAt ?? record.createdAt).toISOString(),
    };
}

export function toSectionDto(record: SectionRecord): SectionDto {
    return {
        id: record.id,
        key: record.key,
        question: record.question,
        guidance: record.guidance,
        wordLimit: record.wordLimit,
        required: record.required,
        status: record.status,
        draft: record.draft,
        words: wordCount(record.draft),
        cites: record.draftMeta?.cites ?? [],
        gaps: record.draftMeta?.gaps ?? [],
        evidence: (record.draftMeta?.evidence ?? []).map(toEvidenceDto),
        libraryItemIds: record.draftMeta?.libraryItemIds ?? [],
        draftedAt: record.draftMeta?.draftedAt ?? null,
    };
}

export function toApplicationRow(
    record: ApplicationRecord,
    sections: SectionRecord[],
    now: Date
): ApplicationRow {
    return {
        id: record.id,
        title: record.title,
        funder: record.funder,
        status: record.status,
        deadline: record.deadline,
        daysLeft: daysUntil(record.deadline, now),
        readiness: record.readiness,
        sections: {
            total: sections.length,
            written: sections.filter(s => s.status !== "empty").length,
            approved: sections.filter(s => s.status === "approved").length,
        },
        blockers: record.review?.findings.filter(f => f.severity === "blocker").length ?? 0,
        updatedAt: (record.updatedAt ?? record.createdAt).toISOString(),
    };
}

export function toApplicationDetail(
    record: ApplicationRecord,
    sections: SectionRecord[],
    now: Date
): ApplicationDetail {
    return {
        ...toApplicationRow(record, sections, now),
        opportunityId: record.opportunityId,
        requestText: record.requestText,
        requestUrl: record.requestUrl,
        requestDocumentId: record.requestDocumentId,
        requestSummary: record.extracted?.summary ?? null,
        amountMin: record.extracted?.amountMin ?? null,
        amountMax: record.extracted?.amountMax ?? null,
        requirements: record.requirements,
        sectionList: sections.map(toSectionDto),
        review: record.review
            ? {
                  readiness: record.review.readiness,
                  summary: record.review.summary,
                  findings: record.review.findings,
                  reviewedAt: record.review.reviewedAt,
              }
            : null,
        notes: record.notes,
        exportedDocumentId: record.exportedDocumentId,
        exportedHref: sourceHref(record.exportedDocumentId),
    };
}

export function toLibraryItemDto(
    record: LibraryItemRecord,
    titles: ReadonlyMap<string, string>
): LibraryItemDto {
    return {
        id: record.id,
        question: record.question,
        answer: record.answer,
        tags: record.tags,
        evidence: record.evidence.map(toEvidenceDto),
        sourceApplicationId: record.sourceApplicationId,
        sourceApplicationTitle: record.sourceApplicationId
            ? (titles.get(record.sourceApplicationId) ?? null)
            : null,
        uses: record.uses,
        updatedAt: (record.updatedAt ?? record.createdAt).toISOString(),
    };
}

export function toRunDto(record: RunRecord): RunDto {
    return {
        id: record.id,
        kind: record.kind,
        status: record.status,
        applicationId: record.applicationId,
        startedAt: (record.startedAt ?? record.createdAt).toISOString(),
        completedAt: record.completedAt?.toISOString() ?? null,
        steps: record.steps.map(s => ({
            id: s.id,
            label: s.label,
            status: s.status,
            detail: s.detail,
        })),
        headline: record.summary?.headline ?? null,
        error: record.error,
        credits: record.creditsUsed,
    };
}

/** The open applications, nearest deadline first, undated last. */
export function byDeadline<T extends { deadline: string | null }>(rows: T[]): T[] {
    return [...rows].sort((a, b) => {
        if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
        if (a.deadline) return -1;
        if (b.deadline) return 1;
        return 0;
    });
}

export const OPEN_STATUSES = new Set(["draft", "in_progress", "in_review", "ready"]);

/**
 * What to do next, in order of urgency: a missing profile, a deadline this
 * week that is not ready, strong funders nobody has decided on, sections
 * still unwritten on something in progress.
 */
export function buildTodo(input: {
    profileReady: boolean;
    sources: number;
    applications: ApplicationRow[];
    funders: FunderRow[];
    href: (path: string) => string;
}): TodoItem[] {
    const todo: TodoItem[] = [];
    if (!input.profileReady) {
        todo.push({
            id: "profile",
            title: "Build your organisation profile",
            detail:
                input.sources > 0
                    ? `Reads your ${input.sources} sources once; every draft starts from it.`
                    : "Add a few sources first — past proposals, reports, your website — then build it.",
            action: { label: "Profile", href: input.href("/profile") },
        });
    }
    for (const app of byDeadline(input.applications.filter(a => OPEN_STATUSES.has(a.status)))) {
        if (app.daysLeft !== null && app.daysLeft <= 7 && app.readiness < 100) {
            todo.push({
                id: `deadline:${app.id}`,
                title:
                    app.daysLeft < 0
                        ? `${app.title} is past its deadline`
                        : app.daysLeft === 0
                          ? `${app.title} is due today`
                          : `${app.title} is due in ${app.daysLeft} day${app.daysLeft === 1 ? "" : "s"}`,
                detail: `${app.readiness}% ready · ${app.sections.written} of ${app.sections.total} sections written${app.blockers ? ` · ${app.blockers} blocker${app.blockers === 1 ? "" : "s"}` : ""}`,
                action: { label: "Open", href: input.href(`/write/${app.id}`) },
            });
        }
    }
    const strong = input.funders.filter(f => f.status === "candidate" && (f.fit ?? 0) >= 70);
    if (strong.length > 0) {
        todo.push({
            id: "funders",
            title: `${strong.length} strong-fit funder${strong.length === 1 ? "" : "s"} to decide on`,
            detail: strong
                .slice(0, 3)
                .map(f => f.funder)
                .join(", "),
            action: { label: "Funders", href: input.href("/funders") },
        });
    }
    for (const app of input.applications.filter(
        a => a.status === "in_progress" && a.sections.total > a.sections.written
    )) {
        if (todo.some(t => t.id === `deadline:${app.id}`)) continue;
        todo.push({
            id: `sections:${app.id}`,
            title: `${app.sections.total - app.sections.written} section${app.sections.total - app.sections.written === 1 ? "" : "s"} to write for ${app.title}`,
            detail: app.funder ?? "Funder not set",
            action: { label: "Draft", href: input.href(`/write/${app.id}`) },
        });
    }
    return todo.slice(0, 6);
}
