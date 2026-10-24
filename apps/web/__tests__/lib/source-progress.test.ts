import { createTranslator } from "use-intl";

import { englishMessages } from "~/i18n/messages";
import {
    describeSourceProgress,
    retryCountdown,
    type SourceProcessingView,
} from "~/lib/source-progress";

const t = createTranslator({
    locale: "en",
    messages: englishMessages,
    namespace: "sources.progress",
});

const NOW = new Date("2026-10-23T12:00:00Z");

function view(overrides: Partial<SourceProcessingView> = {}): SourceProcessingView {
    return {
        jobId: "job-1",
        status: "processing",
        progress: null,
        retryCount: 0,
        retry: null,
        ...overrides,
    };
}

function at(stage: "reading" | "chunking" | "embedding" | "finishing", extra = {}) {
    return { stage, updatedAt: NOW.toISOString(), ...extra };
}

describe("describeSourceProgress", () => {
    it("has no number before the worker has reported anything", () => {
        expect(describeSourceProgress(undefined, t, NOW)).toEqual({
            percent: null,
            label: "Syncing…",
            waiting: null,
        });
        // Running, but from before progress was recorded: no made-up figure.
        expect(describeSourceProgress(view(), t, NOW)).toMatchObject({
            percent: null,
            label: "Processing",
        });
    });

    it("starts a queued job at zero", () => {
        expect(describeSourceProgress(view({ status: "queued" }), t, NOW)).toMatchObject({
            percent: 0,
            label: "Queued",
        });
    });

    it("walks the stages in order, never going backwards", () => {
        const steps = [
            at("reading"),
            at("chunking", { pages: 259 }),
            at("embedding", { done: 0, total: 267, pages: 259 }),
            at("embedding", { done: 120, total: 267, pages: 259 }),
            at("embedding", { done: 267, total: 267, pages: 259 }),
            at("finishing", { pages: 259 }),
        ];
        const shown = steps.map(progress => describeSourceProgress(view({ progress }), t, NOW));

        expect(shown.map(s => s.label)).toEqual([
            "Reading pages",
            "Preparing 259 pages",
            "Embedding 0/267",
            "Embedding 120/267",
            "Embedding 267/267",
            "Finishing",
        ]);
        const percents = shown.map(s => s.percent!);
        expect(percents).toEqual([5, 30, 35, 61, 95, 95]);
        for (let i = 1; i < percents.length; i++) {
            expect(percents[i]).toBeGreaterThanOrEqual(percents[i - 1]!);
        }
    });

    it("never claims 100 while the source is still processing", () => {
        const done = describeSourceProgress(
            view({ progress: at("embedding", { done: 999, total: 10 }) }),
            t,
            NOW
        );
        expect(done.percent).toBe(95);
    });

    it("keeps the bar where it was while a stage waits to retry, and says when", () => {
        const shown = describeSourceProgress(
            view({
                progress: at("embedding", { done: 100, total: 267 }),
                retry: {
                    attempt: 3,
                    maxAttempts: 8,
                    nextAttemptAt: "2026-10-23T12:04:00Z",
                    lastError: "OpenAI API error: 429 - RESOURCE_EXHAUSTED",
                },
            }),
            t,
            NOW
        );
        expect(shown.percent).toBe(57);
        expect(shown.label).toBe("Retrying in 4 min");
        expect(shown.waiting).toMatchObject({ attempt: 3, maxAttempts: 8 });
    });

    it("says 'Retrying' once the retry is due", () => {
        const shown = describeSourceProgress(
            view({
                retry: {
                    attempt: 2,
                    maxAttempts: 8,
                    nextAttemptAt: "2026-10-23T11:59:00Z",
                    lastError: null,
                },
            }),
            t,
            NOW
        );
        expect(shown.label).toBe("Retrying");
    });
});

describe("retryCountdown", () => {
    it("rounds to what a person reads at a glance", () => {
        expect(retryCountdown(new Date("2026-10-23T12:00:03Z"), t, NOW)).toBe("Retrying now");
        expect(retryCountdown(new Date("2026-10-23T12:00:40Z"), t, NOW)).toBe("Retrying in 40 s");
        expect(retryCountdown(new Date("2026-10-23T12:16:10Z"), t, NOW)).toBe("Retrying in 16 min");
    });
});
