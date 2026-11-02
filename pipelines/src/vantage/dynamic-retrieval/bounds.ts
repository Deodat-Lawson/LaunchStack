import { ContextPortErrorV0 } from "../context-v0/ports";
import type { ContextBudgetsV0 } from "../proposals/context-v0";

export function checkBudgets(budgets: ContextBudgetsV0) {
    for (const value of Object.values(budgets))
        if (!Number.isSafeInteger(value) || value < 0)
            throw new ContextPortErrorV0("Budgets must be non-negative safe integers.", 400);
}

export class SearchTimeout extends Error {
    constructor() {
        super("Context search deadline exceeded.");
    }
}

/** Clear timers and abort cooperative providers on expiry; never await a hung provider. */
export async function boundedCall<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    timeoutMs: number,
    parentSignal?: AbortSignal
): Promise<T> {
    if (timeoutMs <= 0 || parentSignal?.aborted) throw new SearchTimeout();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    const timeout = new Promise<never>((_, reject) => {
        abort = () => {
            controller.abort();
            reject(new SearchTimeout());
        };
        parentSignal?.addEventListener("abort", abort, { once: true });
        timer = setTimeout(abort, Math.min(timeoutMs, 2_147_483_647));
    });
    try {
        return await Promise.race([
            Promise.resolve().then(() => operation(controller.signal)),
            timeout,
        ]);
    } finally {
        clearTimeout(timer);
        if (abort) parentSignal?.removeEventListener("abort", abort);
        controller.abort();
    }
}

const stopWords = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "this",
    "that",
    "our",
    "are",
    "was",
    "has",
    "have",
    "into",
]);
export const terms = (text: string): string[] =>
    [
        ...new Set(
            (text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter(
                word => !stopWords.has(word)
            )
        ),
    ].sort();
export const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export const tokenCeiling = (text: string) => new TextEncoder().encode(text).length;
