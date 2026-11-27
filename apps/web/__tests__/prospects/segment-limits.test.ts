/**
 * A segment's answers have limits, and going over one is said as exactly
 * that: which answer, how long it is and how long it may be — never "Name,
 * what you sell and where to look are required" for an answer that is there
 * but long. The name is made from the answers, so it is cut to fit instead
 * of refused.
 */
import type { NextRequest } from "next/server";

const mockCreateSegment = jest.fn();
jest.mock("~/server/prospects/service", () => ({
    createSegment: (...args: unknown[]) => mockCreateSegment(...args),
    listSegments: jest.fn(async () => []),
    ProspectsError: class extends Error {},
    StageTransitionError: class extends Error {},
}));
jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspaceContext: jest.fn(async () => ({
        success: true,
        data: { companyId: 1n, authUserId: "u1", userPk: 1 },
    })),
}));

import { POST } from "~/app/api/prospects/segments/route";
import {
    SEGMENT_LIMITS,
    fitSegmentName,
    segmentLimitProblems,
} from "~/lib/prospects/segment-limits";

const answers = {
    name: "restaurants · Baltimore, MD, USA",
    offering: "Bookkeeping and payroll for independent restaurants",
    industries: ["restaurants"],
    places: ["Baltimore, MD, USA"],
};

function post(body: Record<string, unknown>, locale?: string) {
    return POST(
        new Request("http://localhost/api/prospects/segments", {
            method: "POST",
            headers: {
                "content-type": "application/json",
                ...(locale ? { cookie: `ls-locale=${locale}.1` } : {}),
            },
            body: JSON.stringify(body),
        }) as unknown as NextRequest
    );
}

beforeEach(() => {
    mockCreateSegment.mockReset();
    mockCreateSegment.mockImplementation(async (_ctx: unknown, input: { name: string }) => ({
        id: "seg-1",
        name: input.name,
    }));
});

describe("segmentLimitProblems", () => {
    it("finds nothing in answers within their limits", () => {
        expect(segmentLimitProblems(answers)).toEqual([]);
        expect(
            segmentLimitProblems({
                offering: "x".repeat(SEGMENT_LIMITS.offering),
                industries: ["y".repeat(SEGMENT_LIMITS.buyer)],
                places: ["z".repeat(SEGMENT_LIMITS.place)],
            })
        ).toEqual([]);
    });

    it("names each answer over its limit, with its length and the limit", () => {
        expect(
            segmentLimitProblems({
                offering: "x".repeat(4_321),
                industries: ["restaurants", "y".repeat(250)],
                places: Array.from({ length: 21 }, (_, i) => `Place ${i}`),
            })
        ).toEqual([
            { field: "buyers", key: "buyerTooLong", count: 250, max: 200 },
            { field: "places", key: "placesTooMany", count: 21, max: 20 },
            { field: "offering", key: "offeringTooLong", count: 4_321, max: 4_000 },
        ]);
    });
});

describe("fitSegmentName", () => {
    it("keeps a name that fits", () => {
        expect(fitSegmentName("  restaurants · Baltimore  ")).toBe("restaurants · Baltimore");
    });

    it("cuts a long one to the column with an ellipsis", () => {
        const name = fitSegmentName(`${"a".repeat(300)} · Baltimore`);
        expect(name).toHaveLength(SEGMENT_LIMITS.name);
        expect(name.endsWith("…")).toBe(true);
    });

    it("never cuts a character in half", () => {
        const name = fitSegmentName(`${"a".repeat(254)}😀😀😀`);
        expect(name).toBe(`${"a".repeat(254)}…`);
    });
});

describe("POST /api/prospects/segments", () => {
    it("says “What you sell” is too long, and by how much, instead of asking for it", async () => {
        const res = await post({ ...answers, offering: "x".repeat(4_321) });
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({
            error: "“What you sell” is 4,321 characters; it can be up to 4,000.",
            field: "offering",
        });
        expect(mockCreateSegment).not.toHaveBeenCalled();
    });

    it("says so in the reader's language", async () => {
        const res = await post({ ...answers, offering: "x".repeat(4_321) }, "zh-CN");
        expect((await res.json()).error).toBe("“你销售什么”有 4,321 个字符，最多 4,000 个。");
    });

    it("names a kind of buyer or a place that is too long", async () => {
        const buyer = await post({ ...answers, industries: ["restaurants", "y".repeat(250)] });
        expect(await buyer.json()).toEqual({
            error: "Each kind of buyer can be up to 200 characters; one is 250. Separate kinds with commas.",
            field: "buyers",
        });
        const place = await post({ ...answers, places: ["z".repeat(240)] });
        expect(await place.json()).toEqual({
            error: "Each place can be up to 200 characters; one is 240. Separate places with “;”.",
            field: "places",
        });
    });

    it("takes long answers that fit, cutting the name made from them", async () => {
        const buyers = ["b".repeat(190), "c".repeat(190)];
        const res = await post({
            ...answers,
            name: `${buyers.join(", ")} · Baltimore, MD, USA`,
            industries: buyers,
            offering: "x".repeat(4_000),
        });
        expect(res.status).toBe(201);
        const [, input] = mockCreateSegment.mock.calls[0] as [unknown, { name: string }];
        expect(input.name).toHaveLength(SEGMENT_LIMITS.name);
        expect(input.name.endsWith("…")).toBe(true);
    });

    it("asks for what is missing, and where to look", async () => {
        const missing = await post({ ...answers, offering: "   " });
        expect((await missing.json()).error).toBe(
            "Name, what you sell and where to look are required"
        );
        const nowhere = await post({ ...answers, places: [] });
        expect(await nowhere.json()).toEqual({
            error: "Say where to look: a city, a state or a country.",
            field: "places",
        });
    });
});
