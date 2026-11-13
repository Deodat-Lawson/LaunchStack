import { describe, expect, it } from "vitest";

import { buildDecisionRequest } from "../decide";
import { buildFeeds } from "../recommend";
import { createRng } from "../rng";
import { persona, smallWorld } from "./helpers";

describe("what a persona knows", () => {
    it("leaves the turn prompt unchanged when a persona has no knows or slot", () => {
        const plain = smallWorld();
        const tagged = smallWorld({
            personas: ["a1", "a2", "a3", "a4"].map((id, i) =>
                persona(id, { slotId: `s0${i + 1}`, knows: [] })
            ),
        });
        const feedsA = buildFeeds(plain, ["a1"], createRng(1));
        const feedsB = buildFeeds(tagged, ["a1"], createRng(1));
        const a = buildDecisionRequest(plain, plain.agents[0]!, feedsA.get("a1") ?? []);
        const b = buildDecisionRequest(tagged, tagged.agents[0]!, feedsB.get("a1") ?? []);
        expect(b).toEqual(a);
        expect(a.system).not.toContain("What you know from your own work");
    });

    it("puts at most five known facts after the persona", () => {
        const world = smallWorld({
            personas: [
                persona("a1", {
                    knows: ["Northwind uses Acme Legacy.", "a", "b", "c", "d", "sixth"],
                }),
                persona("a2"),
            ],
        });
        const feed = buildFeeds(world, ["a1"], createRng(1)).get("a1") ?? [];
        const request = buildDecisionRequest(world, world.agents[0]!, feed);
        expect(request.system).toContain(
            "What you know from your own work:\n- Northwind uses Acme Legacy.\n- a\n- b\n- c\n- d"
        );
        expect(request.system).not.toContain("sixth");
        // The block sits between the persona and the behaviour rules.
        expect(request.system.indexOf("What you know")).toBeLessThan(
            request.system.indexOf("You are on a social network")
        );
    });
});
