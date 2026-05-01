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

import type { CreditsPort, DebitInput } from "./types";
import { createSlot } from "../internal/slot";

const portSlot = createSlot<CreditsPort>("credits/port");

export function configureCredits(port: CreditsPort): void {
  portSlot.set(port);
}

/** Throws when no port has been registered — use only when a debit is required. */
export function getCredits(): CreditsPort {
  const port = portSlot.get();
  if (!port) {
    throw new Error(
      "[@launchstack/core/credits] No CreditsPort registered. The host must pass `credits.port` to createEngine (or call configureCredits directly).",
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
  const port = portSlot.get();
  if (!port) return;
  try {
    await port.debit(input);
  } catch (err) {
    console.warn("[@launchstack/core/credits] Debit failed (non-blocking):", err);
  }
}
