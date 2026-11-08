import { researchIntent } from "~/server/prospects/research-intent";

const now = new Date("2026-11-05T18:00:00.000Z");

function ago(ms: number): Date {
    return new Date(now.getTime() - ms);
}

describe("researchIntent", () => {
    it("does nothing when a dossier already exists", () => {
        expect(
            researchIntent([{ type: "research_started", occurredAt: ago(1_000) }], true, true, now)
        ).toBe("none");
    });

    it("waits on a start that is still fresh, even when this request did not ask", () => {
        expect(
            researchIntent(
                [{ type: "research_started", occurredAt: ago(60_000) }],
                false,
                false,
                now
            )
        ).toBe("pending");
    });

    it("does not start from a poll", () => {
        expect(researchIntent([], false, false, now)).toBe("none");
        expect(
            researchIntent([{ type: "researched", occurredAt: ago(1_000) }], false, false, now)
        ).toBe("none");
    });

    it("starts when asked, including after a finished attempt", () => {
        expect(researchIntent([], false, true, now)).toBe("start");
        expect(
            researchIntent([{ type: "researched", occurredAt: ago(1_000) }], false, true, now)
        ).toBe("start");
    });

    it("reads the site again when asked to refresh, and waits on that refresh", () => {
        expect(researchIntent([], true, "refresh", now)).toBe("start");
        const started = [
            { type: "research_started", occurredAt: ago(5_000), payload: { refresh: true } },
        ];
        expect(researchIntent(started, true, false, now)).toBe("pending");
        expect(researchIntent(started, true, "refresh", now)).toBe("pending");
        expect(
            researchIntent([{ type: "researched", occurredAt: ago(1_000) }], true, false, now)
        ).toBe("none");
    });

    it("starts again when the previous start went quiet", () => {
        expect(
            researchIntent(
                [{ type: "research_started", occurredAt: ago(3 * 60 * 1000) }],
                false,
                true,
                now
            )
        ).toBe("start");
    });
});
