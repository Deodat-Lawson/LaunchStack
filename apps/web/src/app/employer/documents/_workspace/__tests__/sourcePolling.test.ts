import {
    nextSourcePollDelay,
    processingActivity,
    SOURCE_POLL,
    sourcePollDelay,
} from "../sourcePolling";

/**
 * Each poll is three requests, and GET /api/folders allows 300 per 15
 * minutes. The old flat 3s poll was exactly that budget, forever.
 */
describe("source poll schedule", () => {
    /** Every delay the schedule will wait before it gives up. */
    function wholeSchedule(): number[] {
        const delays: number[] = [];
        for (let tick = 0; ; tick++) {
            const delay = nextSourcePollDelay(tick);
            if (delay === null) return delays;
            delays.push(delay);
        }
    }

    it("starts at 3s and slows down by half again each poll, up to 30s", () => {
        expect([0, 1, 2, 3, 4, 5, 6, 20].map(sourcePollDelay)).toEqual([
            3000, 4500, 6750, 10125, 15188, 22781, 30000, 30000,
        ]);
    });

    it("gives up once it has watched the same sources for half an hour", () => {
        const delays = wholeSchedule();
        const watched = delays.reduce((sum, delay) => sum + delay, 0);
        expect(watched).toBeLessThanOrEqual(SOURCE_POLL.giveUpAfterMs);
        expect(watched + SOURCE_POLL.maxMs).toBeGreaterThan(SOURCE_POLL.giveUpAfterMs);
        expect(delays).toHaveLength(63);
    });

    it("stays far inside the 15-minute read budget the flat poll used up", () => {
        let elapsed = 0;
        let polls = 0;
        for (const delay of wholeSchedule()) {
            elapsed += delay;
            if (elapsed > 15 * 60_000) break;
            polls++;
        }
        // The flat 3s poll made 300 in the same 15 minutes.
        expect(polls).toBeLessThanOrEqual(35);
    });
});

describe("polling a long job that keeps moving", () => {
    it("keeps going past half an hour while the worker reports progress", () => {
        // Progress seen on every 10th poll: the budget keeps refilling.
        let movedAt = 0;
        for (let tick = 0; tick < 200; tick++) {
            if (tick % 10 === 0) movedAt = tick;
            expect(nextSourcePollDelay(tick, tick - movedAt)).not.toBeNull();
        }
    });

    it("never speeds back up — the pace is the full schedule's", () => {
        expect(nextSourcePollDelay(100, 0)).toBe(SOURCE_POLL.maxMs);
    });

    it("still gives up half an hour after the last progress", () => {
        const movedAt = 100;
        let tick = movedAt;
        while (nextSourcePollDelay(tick, tick - movedAt) !== null) tick++;
        const quietPolls = tick - movedAt;
        expect(quietPolls * SOURCE_POLL.maxMs).toBeLessThanOrEqual(
            SOURCE_POLL.giveUpAfterMs + SOURCE_POLL.maxMs
        );
        expect(quietPolls).toBe(60);
    });
});

describe("processingActivity", () => {
    const at = "2026-10-23T12:00:00Z";
    const embedding = (done: number) => ({
        id: 1,
        processing: {
            status: "processing",
            progress: { stage: "embedding", done },
            retry: null,
        },
    });

    it("changes when another batch is embedded, and not otherwise", () => {
        const before = processingActivity([embedding(50)]).signature;
        expect(processingActivity([embedding(50)]).signature).toBe(before);
        expect(processingActivity([embedding(100)]).signature).not.toBe(before);
    });

    it("ignores sources with nothing reported", () => {
        expect(processingActivity([{ id: 2 }, { id: 3, processing: null }])).toEqual({
            signature: "",
            retryDueAt: 0,
        });
    });

    it("reports when the latest scheduled retry is due", () => {
        const { retryDueAt } = processingActivity([
            {
                id: 1,
                processing: {
                    status: "processing",
                    progress: null,
                    retry: { attempt: 3, nextAttemptAt: at },
                },
            },
        ]);
        expect(retryDueAt).toBe(Date.parse(at));
    });
});
