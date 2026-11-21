import { createHash } from "node:crypto";

export type DocumentQuery = (sql: string, parameters?: unknown[]) => Promise<Record<string, unknown>[]>;
export type CanonicalChunk = { id: string | number | bigint; page_number: number | null; line_start: number | null; content: string };
/** PostgreSQL ascending ordering puts NULL last. Text is preserved byte for byte. */
export function canonicalVersionText(chunks: readonly CanonicalChunk[]): string {
    const compareNullable = (a: number | null, b: number | null) => a === b ? 0 : a === null ? 1 : b === null ? -1 : a - b;
    return [...chunks].sort((a, b) => compareNullable(a.page_number, b.page_number)
        || compareNullable(a.line_start, b.line_start) || (BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0))
        .map(chunk => chunk.content).join("\n");
}
export const canonicalTextHash = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");
export const CANONICAL_VERSION_HASH_SQL = "SELECT encode(sha256(convert_to(COALESCE(string_agg(content,E'\\n' ORDER BY page_number,line_start,id),''),'UTF8')),'hex') AS content_hash FROM pdr_ai_v2_document_context_chunks WHERE version_id=$1::bigint";
export async function canonicalVersionHash(query: DocumentQuery, versionId: string): Promise<string> {
    const [row] = await query(CANONICAL_VERSION_HASH_SQL, [versionId]);
    return String(row?.content_hash);
}
export type DigestItem = { kind: "fact" | "number" | "open_item" | "decision" | "date" | "person"; text: string; quote: string; location: { start: number; end: number } };
export type DocumentDigest = { id: string; versionId: string; contentHash: string; formatVersion: "doc-digest/1"; headline: string; items: DigestItem[] };
export type DigestProvider = (input: { title: string; text: string; signal?: AbortSignal }) => Promise<{ headline: string; items: Array<Omit<DigestItem, "location">> }>;
const kinds = new Set(["fact", "number", "open_item", "decision", "date", "person"]);
export function groundDigest(value: Awaited<ReturnType<DigestProvider>>, text: string) {
    let previousEnd = 0;
    const items: DigestItem[] = [];
    for (const item of value.items.slice(0, 24)) {
        if (!kinds.has(item.kind) || typeof item.text !== "string" || typeof item.quote !== "string" || !item.quote) continue;
        let start = text.indexOf(item.quote, previousEnd);
        if (start < 0) start = text.indexOf(item.quote);
        if (start < 0) continue;
        previousEnd = start + item.quote.length;
        items.push({ ...item, location: { start, end: previousEnd } });
    }
    return { headline: String(value.headline).slice(0, 200), items };
}
/** Deterministic content-only fixture provider. No evaluator inputs are accepted. */
export const deterministicDigestProvider: DigestProvider = async ({ title, text }) => {
    const lines = text.split("\n").map(line => line.trim()).filter(line => line.length >= 30 && line.length <= 600);
    const substantive = lines.filter(line => !/^Reference entry \d+: Routine fictional workspace background/i.test(line));
    const important = substantive.filter(line => /[0-9]|decision|risk|blocked|rollback|customer|security|revenue|metric/i.test(line));
    return { headline: title.slice(0, 200), items: [...new Set([...important, ...substantive])].slice(0, 24).map(quote => ({ kind: /[0-9]/.test(quote) ? "number" : "fact", text: quote, quote })) };
};
/** The application supplies the configured real route. Selecting a route never invokes it. */
export function configuredDigestProvider(mode: string | undefined, real?: DigestProvider): DigestProvider | undefined {
    if (mode === "injected") return deterministicDigestProvider;
    if (mode === "real") return real;
    return undefined;
}

/** ACL and restriction checks precede every cache read, body transfer and provider call. */
export async function getDigestsForVersions(input: {
    companyId: string; versionIds: string[];
    documentScope: (document: { id: number; category: string }) => boolean;
    query: DocumentQuery; provider?: DigestProvider; signal?: AbortSignal;
    /** Refresh the actor's current ACL when independent short transactions are used. */
    authorizeDocument?: (document: { id: number; category: string }) => Promise<boolean>;
}): Promise<Map<string, DocumentDigest>> {
    const result = new Map<string, DocumentDigest>();
    for (const versionId of [...new Set(input.versionIds)].slice(0, 50)) {
        input.signal?.throwIfAborted();
        const authorize = async () => {
            const [document] = await input.query("SELECT d.id,d.category,d.title FROM pdr_ai_v2_document_versions v JOIN pdr_ai_v2_document d ON d.id=v.document_id WHERE v.id=$1::bigint AND d.company_id=$2::bigint", [versionId, input.companyId]);
            if (!document) return undefined;
            const identity = { id: Number(document.id), category: String(document.category) };
            if (!input.documentScope(identity) || (input.authorizeDocument && !await input.authorizeDocument(identity))) return undefined;
            const restricted = await input.query("SELECT 1 FROM pdr_ai_v2_document_settings WHERE document_id=$1::bigint AND restricted=true UNION ALL SELECT 1 FROM pdr_ai_v2_folder_settings f JOIN pdr_ai_v2_category c ON c.id=f.category_id WHERE f.company_id=$2::bigint AND f.visibility='restricted' AND ($3=c.name OR left($3,length(c.name)+1)=c.name||'/')", [document.id, input.companyId, document.category]);
            return restricted.length ? undefined : document;
        };
        const document = await authorize();
        if (!document) continue;
        const contentHash = await canonicalVersionHash(input.query, versionId);
        const read = () => input.query("SELECT id,headline,items FROM pdr_ai_v2_document_version_digests WHERE company_id=$1::bigint AND document_id=$2::bigint AND version_id=$3::bigint AND content_hash=$4 AND format_version='doc-digest/1'", [input.companyId, document.id, versionId, contentHash]);
        let [cached] = await read();
        if (!cached && input.provider) {
            const [stats] = await input.query("SELECT count(*) AS chunk_count,COALESCE(sum(octet_length(content)),0)+GREATEST(count(*)-1,0) AS text_bytes FROM pdr_ai_v2_document_context_chunks WHERE document_id=$1::bigint AND version_id=$2::bigint", [document.id, versionId]);
            if (!stats || Number(stats.chunk_count) < 1 || Number(stats.chunk_count) > 1024 || Number(stats.text_bytes) > 140000) continue;
            const chunks = await input.query("SELECT id,page_number,line_start,content FROM pdr_ai_v2_document_context_chunks WHERE document_id=$1::bigint AND version_id=$2::bigint ORDER BY page_number,line_start,id LIMIT 1025", [document.id, versionId]);
            const text = canonicalVersionText(chunks as CanonicalChunk[]);
            if (chunks.length > 1024 || Buffer.byteLength(text) > 140000 || text.length > 120000 || canonicalTextHash(text) !== contentHash || !await authorize()) continue;
            const digest = groundDigest(await input.provider({ title: String(document.title), text, signal: input.signal }), text);
            input.signal?.throwIfAborted();
            if (!await authorize() || await canonicalVersionHash(input.query, versionId) !== contentHash) continue;
            await input.query("INSERT INTO pdr_ai_v2_document_version_digests (company_id,document_id,version_id,content_hash,format_version,headline,items) VALUES ($1::bigint,$2::bigint,$3::bigint,$4,'doc-digest/1',$5,$6::jsonb) ON CONFLICT (version_id,content_hash,format_version) DO NOTHING", [input.companyId, document.id, versionId, contentHash, digest.headline, JSON.stringify(digest.items)]);
            [cached] = await read();
        }
        if (cached && await authorize() && await canonicalVersionHash(input.query, versionId) === contentHash) result.set(versionId, { id: String(cached.id), versionId, contentHash, formatVersion: "doc-digest/1", headline: String(cached.headline), items: cached.items as DigestItem[] });
    }
    return result;
}
