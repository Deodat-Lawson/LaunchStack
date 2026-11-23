import { canonicalTextHash } from "@launchstack/store/document-digests";
import { rankQuestion } from "@launchstack/pipelines/vantage/question-lexical-ranking";
import { scopeAllowsDocument } from "~/lib/authz/scope-types";
import type { WeeklyReviewAuthorityActor } from "./weekly-review-authority";
import { listPersonalTopics } from "./weekly-review-personal-topics";
import {
    TOPIC_FIRST_LIMITS,
    type TopicProvider,
    type TopicSeed,
    type TopicSeedReason,
    type TopicManifest,
} from "./weekly-review-topic-types";
import {
    WeeklyReviewConflict,
    type WeeklyReviewContext,
    type WeeklyReviewQuery,
} from "./weekly-review-types";

export const TOPIC_LEXICAL_CANDIDATE_LIMIT = 256;

const candidateSelect = `
    SELECT d.id::text AS id, left(d.title,300) AS title, d.category, d.creation_key AS lexical_key,
           v.id::text AS version, v.created_at AS version_date
    FROM pdr_ai_v2_document d
    JOIN LATERAL (
        SELECT id,created_at FROM pdr_ai_v2_document_versions
        WHERE document_id=d.id AND created_at<=$2::timestamptz
        ORDER BY created_at DESC,id DESC LIMIT 1
    ) v ON true
    WHERE d.company_id=$1::bigint
      AND NOT EXISTS (
        SELECT 1 FROM pdr_ai_v2_document_settings s WHERE s.document_id=d.id AND s.restricted
      )
      AND NOT EXISTS (
        SELECT 1 FROM pdr_ai_v2_folder_settings f JOIN pdr_ai_v2_category c ON c.id=f.category_id
        WHERE f.company_id=$1::bigint AND f.visibility='restricted'
          AND (d.category=c.name OR left(d.category,length(c.name)+1)=c.name||'/')
      )
`;

export async function collectTopicSeed(
    query: WeeklyReviewQuery,
    actor: WeeklyReviewAuthorityActor,
    context: WeeklyReviewContext,
    input: {
        cutoff: string;
        asOf: string;
        policyRevision: number;
        roleRevision: number | null;
        expectedActiveId: string | null;
        configuration: { provider: TopicProvider; scoped: boolean };
        carryover: TopicManifest["carryover"];
    }
): Promise<TopicSeed> {
    const access = (row: Record<string, unknown>) =>
        scopeAllowsDocument(actor.documentScope, {
            id: Number(row.id),
            category: String(row.category),
        });
    const watchRows = await query(
        `SELECT DISTINCT document_id::text AS id
        FROM pdr_ai_v2_vantage_personal_topic_watches
        WHERE company_id=$1::bigint AND owner_id=$2`,
        [actor.companyId, actor.userId]
    );
    const watchedIds = watchRows.map(row => String(row.id));
    const carryoverIds = input.carryover === "unavailable" ? [] : input.carryover.seedIds;
    const requested = [...new Set([...watchedIds, ...carryoverIds])];
    const explicit = (
        requested.length
            ? await query(candidateSelect + " AND d.id=ANY($3::bigint[])", [
                  actor.companyId,
                  input.cutoff,
                  requested,
              ])
            : []
    ).filter(access);
    const byId = new Map(explicit.map(row => [String(row.id), row]));
    const topics = (await listPersonalTopics(query, actor, new Set(byId.keys())))
        .filter(topic => topic.status === "active")
        .slice(0, 24);
    const watches = [...new Set(topics.flatMap(topic => topic.watches))];
    const changedAfter = Date.parse(context.week + "T00:00:00.000Z");
    const recent = (
        await query(candidateSelect + " ORDER BY v.created_at DESC,v.id DESC,d.id DESC LIMIT 256", [
            actor.companyId,
            input.cutoff,
        ])
    ).filter(access);
    const changed = recent.filter(
        row => new Date(String(row.version_date)).getTime() >= changedAfter
    );
    const fixedIds = new Set(context.sources.map(source => source.id));
    const lanePool = changed.filter(
        row => !watches.includes(String(row.id)) && !fixedIds.has(String(row.id))
    );
    const ranked = new Map<string, { row: Record<string, unknown>; reason: TopicSeedReason }>();
    const add = (row: Record<string, unknown> | undefined, reason: TopicSeedReason) => {
        if (!row) return;
        const id = String(row.id);
        if (!fixedIds.has(id) && !ranked.has(id)) ranked.set(id, { row, reason });
    };
    for (const id of watches) add(byId.get(id), "watch");
    for (const id of carryoverIds) add(byId.get(id), "carryover");
    // Reserve capacity for the lane independently of earlier seed counts.
    const laneCandidates = lanePool.slice(0, 3);
    const laneIds = new Set(laneCandidates.map(row => String(row.id)));
    for (const row of laneCandidates) add(row, "lane");
    for (const row of changed) add(row, "change");
    for (const row of recent) add(row, "recency");

    const guidance = topics
        .flatMap(topic => [
            ...topic.openQuestions,
            ...topic.decisionChangers,
            ...topic.keywords,
            ...topic.people,
            ...topic.metrics,
        ])
        .join("\n");
    const lexicalEnabled = guidance.trim().length > 0;
    const initialEntries = [...ranked.values()];
    const acquisitionOrder = [
        ...laneCandidates,
        ...initialEntries.map(entry => entry.row).filter(row => !laneIds.has(String(row.id))),
    ].slice(0, TOPIC_LEXICAL_CANDIDATE_LIMIT);
    const bodies = new Map<string, string>();
    let loadedBytes = 0;
    // Probe the original lane/watch/carryover/recency order first, preserving
    // the prior fifty readable parents. Exploration still sees at most fifty.
    for (
        let offset = 0;
        offset < acquisitionOrder.length &&
        loadedBytes < TOPIC_FIRST_LIMITS.loadedParentBytes &&
        (lexicalEnabled || bodies.size < TOPIC_FIRST_LIMITS.offered);

    ) {
        const remaining = TOPIC_FIRST_LIMITS.loadedParentBytes - loadedBytes;
        const parentLimit = Math.min(TOPIC_FIRST_LIMITS.parentBytes, remaining);
        const count = Math.min(
            12,
            Math.max(1, Math.floor(remaining / parentLimit)),
            lexicalEnabled
                ? TOPIC_LEXICAL_CANDIDATE_LIMIT
                : TOPIC_FIRST_LIMITS.offered - bodies.size
        );
        const versions = acquisitionOrder
            .slice(offset, offset + count)
            .map(row => String(row.version));
        offset += count;
        const rows = await query(
            `
            SELECT v.id::text AS version, body.text FROM pdr_ai_v2_document_versions v
            JOIN LATERAL (
                SELECT CASE WHEN count(*) BETWEEN 1 AND 1024
                    AND sum(octet_length(content))+count(*)-1 <= $2
                    THEN string_agg(content,E'\\n' ORDER BY page_number,line_start,id) END AS text
                FROM (
                    SELECT id,content,page_number,line_start FROM pdr_ai_v2_document_context_chunks
                    WHERE version_id=v.id AND document_id=v.document_id
                    ORDER BY page_number,line_start,id LIMIT 1025
                ) b
            ) body ON body.text IS NOT NULL
            WHERE v.id=ANY($1::bigint[])
        `,
            [versions, parentLimit]
        );
        for (const row of rows) {
            if (typeof row.text !== "string") continue;
            loadedBytes += Buffer.byteLength(row.text, "utf8");
            if (loadedBytes > TOPIC_FIRST_LIMITS.loadedParentBytes)
                throw new WeeklyReviewConflict("acquisition_budget");
            if (row.text.length >= 200 && row.text.trim())
                bodies.set(String(row.version), row.text);
        }
    }
    const lexical = rankQuestion(
        guidance,
        initialEntries.flatMap(({ row }) => {
            const text = bodies.get(String(row.version));
            return text === undefined
                ? []
                : [
                      {
                          row,
                          text,
                          filename: String(row.title),
                          sourcePath: String(row.lexical_key ?? row.title),
                      },
                  ];
        })
    ).filter(document => document.lexicalScore > 0);
    ranked.clear();
    for (const id of watches) add(byId.get(id), "watch");
    for (const id of carryoverIds) add(byId.get(id), "carryover");
    for (const row of laneCandidates) add(row, "lane");
    for (const document of lexical) add(document.row, "question");
    for (const row of changed) add(row, "change");
    for (const row of recent) add(row, "recency");
    const entries = [...ranked.values()];
    const reservedLaneCount = laneCandidates.filter(row => bodies.has(String(row.version))).length;
    const selectedIds = new Set(
        entries
            .filter(({ row }) => !laneIds.has(String(row.id)) && bodies.has(String(row.version)))
            .slice(0, TOPIC_FIRST_LIMITS.offered - reservedLaneCount)
            .map(({ row }) => String(row.id))
    );
    for (const row of laneCandidates)
        if (bodies.has(String(row.version))) selectedIds.add(String(row.id));
    const allDocuments = entries
        .filter(({ row }) => selectedIds.has(String(row.id)))
        .flatMap(({ row, reason }) => {
            const id = String(row.id),
                version = String(row.version);
            const text = bodies.get(version);
            if (text === undefined) return [];
            return [
                {
                    ref: `doc:${id}@${version}`,
                    id,
                    version,
                    text,
                    title: String(row.title),
                    versionDate: (row.version_date instanceof Date
                        ? row.version_date
                        : new Date(String(row.version_date))
                    ).toISOString(),
                    hash: canonicalTextHash(text),
                    category: String(row.category),
                    audience: "company" as const,
                    purpose: "retrieved" as const,
                    reason,
                },
            ];
        });
    const laneDocuments = laneCandidates.flatMap(row =>
        allDocuments.filter(document => document.id === String(row.id))
    );
    const lane = laneDocuments.map(document => document.ref);
    const documents = [
        ...allDocuments.filter(document => !laneIds.has(document.id)),
        ...laneDocuments,
    ];
    const manifest: TopicManifest = {
        week: context.week,
        cutoff: input.cutoff,
        asOf: input.asOf,
        epoch: context.authorityEpoch,
        expectedActiveId: input.expectedActiveId,
        configuration: input.configuration,
        revisions: {
            policy: input.policyRevision,
            preference: context.preferenceVersion,
            role: input.roleRevision,
        },
        topics: topics.map(topic => ({
            ...topic,
            watches: topic.watches.filter(
                id => documents.some(document => document.id === id) || fixedIds.has(id)
            ),
        })),
        fixed: context.sources.map(({ ref, id, version, hash, purpose, audience }) => ({
            ref,
            id,
            version,
            hash,
            purpose,
            audience,
        })),
        fixedDependencies: context.dependencies ?? [],
        offered: documents.map(
            ({ text: _text, title: _title, category: _category, ...offer }) => offer
        ),
        lane,
        carryover: input.carryover,
    };
    if (!actor.canMutate) throw new WeeklyReviewConflict("review_mutation_denied", 403);
    return { context, manifest, documents };
}
