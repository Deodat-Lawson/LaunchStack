/**
 * Module-level CreditsPort slot. createEngine calls configureCredits with
 * the port the host provided (when it supplied one); subsystems reach the
 * port via getCredits() / getCreditsOrNull().
 *
 * Unlike the storage/db slots, the credits port is optional — deploys that
 * don't meter per-company token usage simply don't register one. Call
 * `creditsDebitSafe` for fire-and-forget debits that should no-op when no
 * port is configured and never throw on bookkeeping errors.
 */

import type { CreditsPort, DebitInput, MeteringMode } from "./types";
import { createSlot } from "../internal/slot";

const portSlot = createSlot<CreditsPort>("credits/port");
const meteringSlot = createSlot<MeteringMode>("credits/metering");

export function configureCredits(port: CreditsPort): void {
    portSlot.set(port);
}

/**
 * Set by createEngine from CoreConfig.credits.metering, unconditionally, so
 * the slot is never empty for a host that built an engine.
 */
export function configureMetering(mode: MeteringMode): void {
    meteringSlot.set(mode);
}

/**
 * Defaults to "off" rather than to a metered mode. An unset slot means nobody
 * configured metering — most likely a library consumer that never called
 * createEngine — and silently metering someone who never asked for it is the
 * worse failure of the two.
 */
export function getMeteringMode(): MeteringMode {
    return meteringSlot.get() ?? "off";
}

/** True when debits should be recorded at all. */
export function isMeteringEnabled(): boolean {
    return getMeteringMode() !== "off";
}

/**
 * True when a balance check may refuse work. Guard every *blocking* credit
 * check with this — never with isMeteringEnabled(), which is also true for
 * self-hosted deployments that record usage but must never be told no.
 */
export function isMeteringEnforced(): boolean {
    return getMeteringMode() === "enforce";
}

/** Throws when no port has been registered — use only when a debit is required. */
export function getCredits(): CreditsPort {
    const port = portSlot.get();
    if (!port) {
        throw new Error(
            "[@launchstack/adapters/credits] No CreditsPort registered. The host must pass `credits.port` to createEngine (or call configureCredits directly)."
        );
    }
    return port;
}

export function getCreditsOrNull(): CreditsPort | null {
    return portSlot.get() ?? null;
}

/**
 * Best-effort debit. No-op when no port is registered; swallows errors with
 * a warning. Intended for non-blocking bookkeeping calls inside the
 * ingestion / NER / OCR paths.
 */
export async function creditsDebitSafe(input: DebitInput): Promise<void> {
    if (getMeteringMode() === "off") return;
    const port = portSlot.get();
    if (!port) return;
    try {
        await port.debit(input);
    } catch (err) {
        console.warn("[@launchstack/adapters/credits] Debit failed (non-blocking):", err);
    }
}
