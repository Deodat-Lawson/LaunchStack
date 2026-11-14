/**
 * Credit holds for v2 units.
 *
 * Before a unit runs, the engine reserves the most credits it may settle
 * (`maxCredits`); the unit's commit settles what it actually used and lets the
 * rest go, in the same transaction, exactly once. A failed or cancelled run
 * releases whatever it still holds.
 *
 * A hold is a row in `scenario_credit_reservations`, not a ledger entry. It
 * never touches `token_accounts.balance_tokens`, `token_transactions` or
 * `token_usage_daily`: the Usage tab sums debits from those, and a hold that
 * moved the balance would need a hold row and a release row per unit to stay
 * explainable there. Instead admission counts holds against the balance — a
 * unit is admitted while `balance − held ≥ its maxCredits`, read under the
 * company's account row lock so concurrent admissions serialize — and the
 * ledger only ever sees one debit per committed unit: what it used.
 *
 * Every unit gets a reservation row, even one with nothing to hold, so the
 * held → settled guard is the single place that decides a unit was charged.
 */
import { and, eq, sql } from "drizzle-orm";

import type { DbClient } from "@launchstack/store/client";

import { scenarioCreditReservations } from "../schema";

/** The transaction (or client) a credits call runs inside. */
export type CreditsTx = Pick<DbClient, "select" | "insert" | "update" | "execute">;

/** One key per unit execution plan entry: retries and duplicate deliveries share it. */
export function settlementKey(
    companyId: bigint,
    runId: number,
    generation: number,
    unitKey: string
): string {
    return `scenario:${companyId}:${runId}:g${generation}:${unitKey}`;
}

/**
 * The ledger line for a settled unit. Brief, cast, round and report keep the
 * shapes v1 wrote; the ontology and every graph unit get one word each, so the
 * Usage tab can word them too. Other units name their key.
 */
export function settlementDescription(title: string, unitKey: string): string {
    const round = /^round:(\d+)$/.exec(unitKey);
    if (round) return `Scenario "${title}" (round ${Number(round[1])})`;
    const unit = unitKey.startsWith("cast:")
        ? "cast"
        : unitKey.startsWith("graph:")
          ? "graph"
          : unitKey;
    return `Scenario "${title}" (${unit})`;
}

export interface ReserveRequest {
    companyId: bigint;
    runId: number;
    generation: number;
    unitKey: string;
    amount: number;
}

export type ReserveResult =
    | { ok: true; key: string; reserved: number; reused: boolean }
    | { ok: false; key: string; required: number; available: number };

export interface SettleRequest {
    companyId: bigint;
    runId: number;
    generation: number;
    unitKey: string;
    /** Credits the committed unit used. */
    credits: number;
    description: string;
    metadata?: Record<string, unknown>;
}

export type SettleResult =
    | { settled: true; charged: number; released: number }
    | { settled: false; reason: "already_settled" | "released" };

export interface ScenarioCreditsPort {
    /** Hold `amount` for a unit, or reuse the hold it already has. */
    reserve(tx: CreditsTx, request: ReserveRequest): Promise<ReserveResult>;
    /** Charge what the unit used and let the rest of its hold go. Once per key. */
    settle(tx: CreditsTx, request: SettleRequest): Promise<SettleResult>;
    /** Let one hold go; false when it was not held. */
    release(tx: CreditsTx, key: string): Promise<boolean>;
    /** Let every hold of a run go (failure, cancellation, the end of the run). */
    releaseRun(tx: CreditsTx, runId: number): Promise<number>;
}

/** The workspace ledger as holds need it. The app implements it over its token tables. */
export interface ScenarioLedger {
    /** Whether this deployment refuses work the balance cannot cover. */
    enforced(): boolean;
    /** The company's balance, with its account row locked until the transaction ends. */
    lockBalance(tx: CreditsTx, companyId: bigint): Promise<number>;
    /**
     * Record a settled charge. Never refused: the hold admitted the work and
     * the work is done, so a balance another feature spent meanwhile goes
     * negative rather than leaving the charge unrecorded.
     */
    debit(
        tx: CreditsTx,
        input: {
            companyId: bigint;
            amount: number;
            description: string;
            referenceId: string;
            metadata: Record<string, unknown>;
        }
    ): Promise<void>;
}

type ReservationRow = typeof scenarioCreditReservations.$inferSelect;

async function findReservation(tx: CreditsTx, key: string): Promise<ReservationRow | undefined> {
    const [row] = await tx
        .select()
        .from(scenarioCreditReservations)
        .where(eq(scenarioCreditReservations.settlementKey, key))
        .limit(1);
    return row;
}

/** Credits a company already holds for units that have not settled. */
export async function heldCredits(tx: CreditsTx, companyId: bigint): Promise<number> {
    const [row] = await tx
        .select({
            held: sql<number>`coalesce(sum(${scenarioCreditReservations.reserved}), 0)::int`,
        })
        .from(scenarioCreditReservations)
        .where(
            and(
                eq(scenarioCreditReservations.companyId, companyId),
                eq(scenarioCreditReservations.status, "held")
            )
        );
    return Number(row?.held ?? 0);
}

export function createScenarioCredits(ledger: ScenarioLedger): ScenarioCreditsPort {
    return {
        async reserve(tx, request) {
            const key = settlementKey(
                request.companyId,
                request.runId,
                request.generation,
                request.unitKey
            );
            const amount = Math.max(0, Math.ceil(request.amount));
            const enforced = ledger.enforced();
            // The account lock comes first: it is what serializes this
            // company's admissions, so the held sum below cannot move under us.
            const balance = enforced ? await ledger.lockBalance(tx, request.companyId) : 0;

            const existing = await findReservation(tx, key);
            if (existing && existing.status !== "released") {
                // A retry or a second delivery: the unit keeps the hold it has.
                return {
                    ok: true,
                    key,
                    reserved: existing.status === "held" ? existing.reserved : 0,
                    reused: true,
                };
            }

            const hold = enforced ? amount : 0;
            if (enforced && hold > 0) {
                const available = balance - (await heldCredits(tx, request.companyId));
                if (available < hold) return { ok: false, key, required: hold, available };
            }

            if (existing) {
                // Released by a terminal transition this worker has not seen
                // yet; holding again keeps the guard in one place (the run's
                // commit refuses anyway, and the reconciler lets it go).
                await tx
                    .update(scenarioCreditReservations)
                    .set({ status: "held", reserved: hold, settled: null, closedAt: null })
                    .where(eq(scenarioCreditReservations.id, existing.id));
                return { ok: true, key, reserved: hold, reused: false };
            }

            const inserted = await tx
                .insert(scenarioCreditReservations)
                .values({
                    companyId: request.companyId,
                    runId: request.runId,
                    generation: request.generation,
                    unitKey: request.unitKey,
                    settlementKey: key,
                    reserved: hold,
                    status: "held",
                })
                .onConflictDoNothing({ target: scenarioCreditReservations.settlementKey })
                .returning({ id: scenarioCreditReservations.id });
            if (inserted.length > 0) return { ok: true, key, reserved: hold, reused: false };
            // Another worker inserted the same key between our read and write.
            const raced = await findReservation(tx, key);
            return { ok: true, key, reserved: raced?.reserved ?? 0, reused: true };
        },

        async settle(tx, request) {
            const key = settlementKey(
                request.companyId,
                request.runId,
                request.generation,
                request.unitKey
            );
            const credits = Math.max(0, Math.ceil(request.credits));
            const now = new Date();
            const [closed] = await tx
                .update(scenarioCreditReservations)
                .set({ status: "settled", settled: credits, closedAt: now })
                .where(
                    and(
                        eq(scenarioCreditReservations.settlementKey, key),
                        eq(scenarioCreditReservations.status, "held")
                    )
                )
                .returning({ reserved: scenarioCreditReservations.reserved });
            let reserved = closed?.reserved;
            if (reserved === undefined) {
                const existing = await findReservation(tx, key);
                if (existing?.status === "settled")
                    return { settled: false, reason: "already_settled" };
                if (existing) return { settled: false, reason: "released" };
                // A unit that never reserved still records what it used.
                const inserted = await tx
                    .insert(scenarioCreditReservations)
                    .values({
                        companyId: request.companyId,
                        runId: request.runId,
                        generation: request.generation,
                        unitKey: request.unitKey,
                        settlementKey: key,
                        reserved: 0,
                        settled: credits,
                        status: "settled",
                        closedAt: now,
                    })
                    .onConflictDoNothing({ target: scenarioCreditReservations.settlementKey })
                    .returning({ id: scenarioCreditReservations.id });
                if (inserted.length === 0) return { settled: false, reason: "already_settled" };
                reserved = 0;
            }
            if (credits > 0) {
                await ledger.debit(tx, {
                    companyId: request.companyId,
                    amount: credits,
                    description: request.description,
                    referenceId: `scenario:${request.runId}`,
                    metadata: {
                        ...request.metadata,
                        contractVersion: 2,
                        runId: request.runId,
                        generation: request.generation,
                        unitKey: request.unitKey,
                        settlementKey: key,
                        reserved,
                    },
                });
            }
            return { settled: true, charged: credits, released: Math.max(0, reserved - credits) };
        },

        async release(tx, key) {
            const rows = await tx
                .update(scenarioCreditReservations)
                .set({ status: "released", closedAt: new Date() })
                .where(
                    and(
                        eq(scenarioCreditReservations.settlementKey, key),
                        eq(scenarioCreditReservations.status, "held")
                    )
                )
                .returning({ id: scenarioCreditReservations.id });
            return rows.length > 0;
        },

        async releaseRun(tx, runId) {
            const rows = await tx
                .update(scenarioCreditReservations)
                .set({ status: "released", closedAt: new Date() })
                .where(
                    and(
                        eq(scenarioCreditReservations.runId, runId),
                        eq(scenarioCreditReservations.status, "held")
                    )
                )
                .returning({ id: scenarioCreditReservations.id });
            return rows.length;
        },
    };
}
