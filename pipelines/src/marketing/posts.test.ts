import { describe, expect, it } from "vitest";

import { bodyProblem, platformLabel, platformLimit } from "./posts";

describe("brand post rules", () => {
    it("names each network and knows its hard limit", () => {
        expect(platformLabel("x")).toBe("X");
        expect(platformLabel("linkedin")).toBe("LinkedIn");
        expect(platformLimit("x")).toBe(280);
        expect(platformLimit("bluesky")).toBe(300);
        expect(platformLimit("linkedin")).toBe(3000);
    });

    it("refuses an empty post and one over the network's limit, in the user's words", () => {
        expect(bodyProblem("x", "   ")).toBe("Write something first.");
        expect(bodyProblem("x", "a".repeat(281))).toMatch(
            /281 characters is over X's limit of 280/
        );
        expect(bodyProblem("x", "a".repeat(280))).toBeNull();
        expect(bodyProblem("linkedin", "a".repeat(281))).toBeNull();
    });
});
