import {
    selectVersionPairsForReportingPeriod,
    type DocumentVersionForComparison,
} from "@launchstack/pipelines/founder-weekly-review";
import { ContextPortErrorV0 } from "../context-v0/ports";
import {
    contextSourceKeyV0 as key,
    type ContextSourceRefV0,
    type DynamicRetrievalInputV0,
} from "../proposals/context-v0";
import type { RetrievalMetadataV0 } from "./types";

/** The server supplies ACL-checked rows and explicit canonical bindings; no ID guessing. */
export interface AuthorizedFounderVersionV0 {
    source: ContextSourceRefV0;
    version: DocumentVersionForComparison;
}

/** Reuse Founder Weekly Review's version-window semantics, including first-version additions. */
export function founderChangeMetadataV0(
    input: DynamicRetrievalInputV0,
    rows: readonly AuthorizedFounderVersionV0[]
): RetrievalMetadataV0[] {
    if (rows.length > 2000)
        throw new ContextPortErrorV0("Version feed exceeds its bounded limit.", 400);
    const catalog = new Map(input.sourceCatalog.map(entry => [key(entry.source), entry]));
    const authorized = rows.filter(row => {
        const entry = catalog.get(key(row.source));
        return (
            entry?.access === "allowed" &&
            entry.source.kind === "doc" &&
            entry.companyId === input.actor.companyId &&
            (entry.audience.kind === "company"
                ? entry.audience.companyId === input.actor.companyId
                : entry.audience.kind === "actor" &&
                  entry.audience.principalRef === input.actor.principalRef) &&
            row.version.createdAt.getTime() <= Date.parse(input.reportWindow.asOf)
        );
    });
    const start = new Date(input.reportWindow.startInclusive),
        end = new Date(input.reportWindow.endExclusive);
    const pairs = selectVersionPairsForReportingPeriod(
        authorized.map(row => row.version),
        start,
        end
    );
    const changed = new Set(pairs.map(pair => `${pair.documentId}:${pair.currentVersionId}`));
    return authorized
        .filter(({ version }) => version.createdAt >= start && version.createdAt < end)
        .map(({ source, version }) => ({
            source: structuredClone(source),
            title: version.documentTitle,
            topics: [
                version.documentCategory ?? "",
                changed.has(`${version.documentId}:${version.versionId}`)
                    ? "document change"
                    : "document version added",
            ],
            changedAt: version.createdAt.toISOString(),
            origin: {
                connector: "workspace-document",
                id: version.documentId.toString(),
                revision: version.versionId.toString(),
            },
        }));
}
