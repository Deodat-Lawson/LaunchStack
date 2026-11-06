/** Owner-scoped accepted-run storage. Invalid candidates never enter either table. */
import { sql } from "drizzle-orm";
import { toRows } from "@launchstack/store/client";
import { VantageError } from "@launchstack/pipelines/vantage";
import type { ContextualPersistenceStrategy, ContextualReportRow } from "./contextual-host";
export interface GroundingBaseline {
    activeReportId: string | null;
    pointerVersion: number;
    reportVersion: number | null;
    ciphertextHash: string | null;
}
function fail(): never {
    throw new VantageError(
        "The accepted report changed; reload before generating again.",
        409,
        "grounding_baseline_changed"
    );
}
function baseline(value: unknown): GroundingBaseline {
    if (!value || typeof value !== "object") return fail();
    const b = value as GroundingBaseline;
    if (
        !Number.isSafeInteger(b.pointerVersion) ||
        b.pointerVersion < 0 ||
        (b.activeReportId !== null && typeof b.activeReportId !== "string")
    )
        return fail();
    return b;
}
export function createGroundingPersistence(): ContextualPersistenceStrategy {
    return {
        async captureBaseline(reader, ctx, weekStart) {
            const row = toRows<{
                active_report_id: string;
                pointer_version: number;
                version: number;
                hash: string;
            }>(
                await reader.execute(
                    sql`SELECT a.active_report_id::text,a.pointer_version,r.version,md5(r.ciphertext) AS hash FROM pdr_ai_v2_vantage_grounding_active a JOIN pdr_ai_v2_vantage_grounding_runs r ON r.id=a.active_report_id AND r.company_id=a.company_id AND r.owner_user_id=a.owner_user_id WHERE a.company_id=${ctx.companyId} AND a.owner_user_id=${ctx.userPk} AND a.week_start=${weekStart}::date`
                )
            )[0];
            return row
                ? {
                      activeReportId: row.active_report_id,
                      pointerVersion: row.pointer_version,
                      reportVersion: row.version,
                      ciphertextHash: row.hash,
                  }
                : {
                      activeReportId: null,
                      pointerVersion: 0,
                      reportVersion: null,
                      ciphertextHash: null,
                  };
        },
        async read(reader, ctx, selector) {
            const rows = toRows<ContextualReportRow>(
                await reader.execute(
                    selector.reportId
                        ? sql`SELECT id::text,company_id::text,owner_user_id::text,week_start::text,version,ciphertext,key_version FROM pdr_ai_v2_vantage_grounding_runs WHERE id=${selector.reportId}::uuid AND company_id=${ctx.companyId} AND owner_user_id=${ctx.userPk}`
                        : sql`SELECT r.id::text,r.company_id::text,r.owner_user_id::text,r.week_start::text,r.version,r.ciphertext,r.key_version FROM pdr_ai_v2_vantage_grounding_active a JOIN pdr_ai_v2_vantage_grounding_runs r ON r.id=a.active_report_id AND r.company_id=a.company_id AND r.owner_user_id=a.owner_user_id WHERE a.company_id=${ctx.companyId} AND a.owner_user_id=${ctx.userPk} AND a.week_start=${selector.weekStart ?? "2026-10-12"}::date`
                )
            );
            return rows[0] ?? null;
        },
        async persist(tx, { ctx, report, sealed, expectedBaseline }) {
            const expected = baseline(expectedBaseline);
            // Serialize activation per owner/week without holding this lock over any model request.
            await tx.execute(
                sql`SELECT pg_advisory_xact_lock(hashtextextended(${`grounding-active/${ctx.companyId}/${ctx.userPk}/${report.weekStart}`},0))`
            );
            const current = toRows<{
                active_report_id: string;
                pointer_version: number;
                version: number;
                hash: string;
            }>(
                await tx.execute(
                    sql`SELECT a.active_report_id::text,a.pointer_version,r.version,md5(r.ciphertext) AS hash FROM pdr_ai_v2_vantage_grounding_active a JOIN pdr_ai_v2_vantage_grounding_runs r ON r.id=a.active_report_id AND r.company_id=a.company_id AND r.owner_user_id=a.owner_user_id WHERE a.company_id=${ctx.companyId} AND a.owner_user_id=${ctx.userPk} AND a.week_start=${report.weekStart}::date FOR UPDATE OF a,r`
                )
            )[0];
            if (
                expected.activeReportId === null
                    ? !!current
                    : !current ||
                      current.active_report_id !== expected.activeReportId ||
                      current.pointer_version !== expected.pointerVersion ||
                      current.version !== expected.reportVersion ||
                      current.hash !== expected.ciphertextHash
            )
                fail();
            await tx.execute(
                sql`INSERT INTO pdr_ai_v2_vantage_grounding_runs(id,company_id,owner_user_id,week_start,version,ciphertext,key_version) VALUES(${report.id}::uuid,${ctx.companyId},${ctx.userPk},${report.weekStart}::date,1,${sealed.ciphertext},${sealed.keyVersion})`
            );
            if (!current) {
                const inserted = toRows(
                    await tx.execute(
                        sql`INSERT INTO pdr_ai_v2_vantage_grounding_active(company_id,owner_user_id,week_start,active_report_id,pointer_version) VALUES(${ctx.companyId},${ctx.userPk},${report.weekStart}::date,${report.id}::uuid,1) ON CONFLICT DO NOTHING RETURNING active_report_id`
                    )
                );
                if (!inserted.length) fail();
            } else {
                const changed = toRows(
                    await tx.execute(
                        sql`UPDATE pdr_ai_v2_vantage_grounding_active SET active_report_id=${report.id}::uuid,pointer_version=pointer_version+1,updated_at=now() WHERE company_id=${ctx.companyId} AND owner_user_id=${ctx.userPk} AND week_start=${report.weekStart}::date AND active_report_id=${expected.activeReportId}::uuid AND pointer_version=${expected.pointerVersion} RETURNING active_report_id`
                    )
                );
                if (!changed.length) fail();
            }
        },
        async review(tx, { ctx, reportId, expectedVersion, nextVersion, sealed }) {
            const changed = toRows(
                await tx.execute(
                    sql`UPDATE pdr_ai_v2_vantage_grounding_runs SET version=${nextVersion},ciphertext=${sealed.ciphertext},key_version=${sealed.keyVersion},updated_at=now() WHERE id=${reportId}::uuid AND company_id=${ctx.companyId} AND owner_user_id=${ctx.userPk} AND version=${expectedVersion} RETURNING id`
                )
            );
            return changed.length === 1;
        },
    };
}
