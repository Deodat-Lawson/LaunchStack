import { describe, expect, it } from "vitest";

import { createEnv } from "./env";
import type { PlaceSegment } from "./segments";
import { answerFor, childBboxes, unansweredBoxes, type NodeAnswer, type World } from "./world";

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

const node = (id: string, places: string[], extra: Partial<NodeAnswer> = {}): NodeAnswer => ({
    id,
    bbox: segment.bbox,
    depth: id.split(".").length - 1,
    places,
    capped: false,
    ...extra,
});

function world(sweeps: World["sweeps"]): World {
    return {
        segment,
        sweeps,
        terms: { plan: [], letters: Object.keys(sweeps), mined: [] },
        places: {
            N1: { id: "N1", name: "Alpha", lon: 1, lat: 1 },
            N2: { id: "N2", name: "Beta", lon: 6, lat: 6 },
        },
        withWebsite: [],
        production: { photonRequests: 0, osmApiRequests: 0, kept: 0, keptOnTarget: [] },
        productionFull: null,
        truth: null,
        photonRequests: 0,
    };
}

describe("a sweep request that got no answer", () => {
    // "a" was answered and came back short; the request for "s" failed.
    const recorded = world({
        a: { r: node("r", ["N1"]) },
        s: { r: node("r", [], { failed: true }) },
    });

    it("is listed as a hole in the world", () => {
        expect(unansweredBoxes(recorded)).toEqual([{ word: "s", box: "r" }]);
    });

    it("costs a request and returns nothing, but never makes the word complete", () => {
        const env = createEnv(recorded);
        const answered = env.open("a");
        expect(answered.next()?.map(item => item.id)).toEqual(["N1"]);
        expect(answered.pending()).toBe(0);
        expect(answered.complete()).toBe(true);

        const unanswered = env.open("s");
        expect(unanswered.pending()).toBe(1);
        // Null, not an empty list: there is nothing here to learn from.
        expect(unanswered.next()).toBeNull();
        expect(unanswered.pending()).toBe(0);
        // An empty box would be complete; a box nobody answered for is not.
        expect(unanswered.complete()).toBe(false);
    });

    it("says nothing about the boxes inside it", () => {
        const [southWest] = childBboxes(segment.bbox);
        // Under an answered, short box the inner box follows from the coordinates.
        expect(answerFor(recorded, "a", "r.0", southWest)?.places).toEqual(["N1"]);
        // Under an unanswered box nothing is known.
        expect(answerFor(recorded, "s", "r.0", southWest)).toBeNull();
    });
});
