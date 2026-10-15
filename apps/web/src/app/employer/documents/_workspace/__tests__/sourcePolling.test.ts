import { nextSourcePollDelay, SOURCE_POLL, sourcePollDelay } from "../sourcePolling";

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
