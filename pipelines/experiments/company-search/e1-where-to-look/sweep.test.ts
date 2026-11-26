import { describe, expect, it } from "vitest";

import { NotRecordedError, type ExchangeSource, type RecordedExchange } from "../lib/recorder";
import type { PlaceSegment } from "./segments";
import { sweep } from "./sweep";
import { PHOTON_CAP, type Place } from "./world";

const segment: PlaceSegment = {
    id: "test",
    label: "Test",
    country: "XX",
    bbox: [0, 0, 8, 8],
    tag: "shop:test",
    selector: '["shop"="test"]',
    q: "test",
    keywords: ["test shop"],
};

const exchange = (status: number, body = "", error?: string): RecordedExchange => ({
    url: "",
    method: "GET",
    status,
    headers: {},
    body,
    truncated: false,
    ms: 1,
    at: "2026-01-01T00:00:00.000Z",
    ...(error ? { error } : {}),
});

/** A page of `count` places inside the test country, as Photon returns them. */
function page(count: number, firstId = 1): string {
    const features = Array.from({ length: count }, (_, i) => ({
        geometry: { coordinates: [1, 1] },
        properties: {
            osm_type: "N",
            osm_id: firstId + i,
            name: `Place ${firstId + i}`,
            countrycode: "XX",
        },
    }));
    return JSON.stringify({ features });
}

/** Stands in for the recorder: answers in the order given, one per request. */
function source(
    mode: ExchangeSource["mode"],
    answers: Array<RecordedExchange | Error>
): ExchangeSource & { asked: number } {
    const self = {
        mode,
        asked: 0,
        exchange: async (): Promise<RecordedExchange> => {
            const next = answers[Math.min(self.asked, answers.length - 1)]!;
            self.asked += 1;
            if (next instanceof Error) throw next;
            return next;
        },
    };
    return self;
}

describe("recording a sweep", () => {
    it("stores an answered box with its places, and splits a full one", async () => {
        const places: Record<string, Place> = {};
        const recorder = source("replay", [
            exchange(200, page(PHOTON_CAP)),
            exchange(200, page(2, 100)),
            exchange(200, page(0)),
            exchange(200, page(0)),
            exchange(200, page(0)),
        ]);
        const swept = await sweep(segment, "a", recorder, places);
        expect(swept.requests).toBe(5);
        expect(swept.unanswered).toBe(0);
        expect(swept.nodes.r).toMatchObject({ capped: true });
        expect(swept.nodes.r!.failed).toBeUndefined();
        expect(swept.nodes["r.0"]!.places).toEqual(["N100", "N101"]);
        // An empty page is an answer: the box holds nothing, and that is known.
        expect(swept.nodes["r.1"]).toMatchObject({ places: [], capped: false });
        expect(swept.nodes["r.1"]!.failed).toBeUndefined();
        expect(Object.keys(places)).toHaveLength(PHOTON_CAP + 2);
    });

    it("stores a box that got no answer as a hole, not as an empty box", async () => {
        const swept = await sweep(segment, "s", source("replay", [exchange(503)]), {});
        expect(swept.requests).toBe(1);
        expect(swept.unanswered).toBe(1);
        expect(swept.nodes.r).toEqual({
            id: "r",
            bbox: segment.bbox,
            depth: 0,
            places: [],
            capped: false,
            failed: true,
        });
    });

    it("asks again while recording, and keeps the answer when one comes", async () => {
        const recorder = source("record", [
            exchange(503),
            exchange(0, "", "fetch failed"),
            exchange(200, page(3)),
        ]);
        const swept = await sweep(segment, "s", recorder, {}, { pauseMs: 0 });
        expect(recorder.asked).toBe(3);
        expect(swept.unanswered).toBe(0);
        expect(swept.nodes.r!.places).toHaveLength(3);
    });

    it("gives up after three tries while recording, and never retries in a replay", async () => {
        const recording = source("record", [exchange(503)]);
        const failed = await sweep(segment, "s", recording, {}, { pauseMs: 0 });
        expect(recording.asked).toBe(3);
        expect(failed.nodes.r!.failed).toBe(true);

        const replay = source("replay", [exchange(503)]);
        await sweep(segment, "s", replay, {}, { pauseMs: 0 });
        expect(replay.asked).toBe(1);
    });

    it("does not ask again for a refusal that will not change", async () => {
        const recorder = source("record", [exchange(400)]);
        const swept = await sweep(segment, "s", recorder, {}, { pauseMs: 0 });
        expect(recorder.asked).toBe(1);
        expect(swept.nodes.r!.failed).toBe(true);
    });

    it("lets a request that was never recorded stop the run", async () => {
        const recorder = source("replay", [
            new NotRecordedError("GET", "https://example.invalid/"),
        ]);
        await expect(sweep(segment, "s", recorder, {})).rejects.toBeInstanceOf(NotRecordedError);
    });
});
