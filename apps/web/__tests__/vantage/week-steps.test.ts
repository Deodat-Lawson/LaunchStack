/**
 * The four steps across the top of the agenda are read off the agenda
 * alone. These pin which are done at each point of the week: a draft with
 * suggestions waiting, a draft with every suggestion answered, a ready
 * agenda, and a held one with and without every kept topic decided.
 */
import { weekSteps } from "~/app/employer/tools/vantage/_components/WeekSteps";

import { agenda, topic } from "./factories";

const done = (a: Parameters<typeof weekSteps>[0]) => weekSteps(a).map(s => s.done);

describe("weekSteps", () => {
    it("names the four steps in order", () => {
        expect(weekSteps(agenda()).map(s => s.label)).toEqual([
            "Review Vantage's suggestions",
            "Ready for the meeting",
            "Hold the meeting",
            "Commit to next steps",
        ]);
    });

    it("has nothing done on a draft with suggestions waiting", () => {
        const a = agenda({
            topics: [
                topic({ id: "s1" }),
                topic({ id: "s2", position: 1 }),
                topic({ id: "k", position: 2, status: "kept" }),
            ],
        });

        expect(done(a)).toEqual([false, false, false, false]);
        expect(weekSteps(a)[0]?.detail).toBe("2 suggestions waiting");
        expect(weekSteps(a)[3]?.detail).toBe("0 of 1 decided");
    });

    it("marks the review done once every suggestion on a draft is answered", () => {
        const a = agenda({
            topics: [
                topic({ id: "k1", status: "kept" }),
                topic({ id: "k2", position: 1, status: "kept" }),
                topic({ id: "d", position: 2, status: "dismissed" }),
            ],
        });

        expect(done(a)).toEqual([true, false, false, false]);
        expect(weekSteps(a)[0]?.detail).toBe("all answered");
        expect(weekSteps(a)[1]?.detail).toBe("2 topics on the agenda");
    });

    it("does not count a decided suggestion as waiting, nor a dismissed topic as kept", () => {
        const a = agenda({
            topics: [
                topic({ id: "s", decision: "Agreed" }),
                topic({ id: "d", position: 1, status: "dismissed", decision: "Agreed" }),
            ],
        });

        expect(done(a)).toEqual([true, false, false, false]);
        expect(weekSteps(a)[3]?.detail).toBe("nothing to decide yet");
    });

    it("marks the agenda ready but the meeting not yet held", () => {
        const a = agenda({ status: "ready", topics: [topic({ status: "kept" })] });

        expect(done(a)).toEqual([true, true, false, false]);
        expect(weekSteps(a)[2]?.detail).toBe("mark it held afterwards");
    });

    it("leaves committing open on a held agenda until every kept topic is decided", () => {
        const a = agenda({
            status: "held",
            topics: [
                topic({ id: "k1", status: "kept", decision: "Agreed: ship it" }),
                topic({ id: "k2", position: 1, status: "kept" }),
            ],
        });

        expect(done(a)).toEqual([true, true, true, false]);
        expect(weekSteps(a)[2]?.detail).toBe("held");
        expect(weekSteps(a)[3]?.detail).toBe("1 of 2 decided");
    });

    it("has every step done on a held agenda with every kept topic decided", () => {
        const a = agenda({
            status: "held",
            topics: [
                topic({ id: "k1", status: "kept", decision: "Agreed: ship it" }),
                topic({ id: "k2", position: 1, status: "kept", decision: "Not now" }),
                topic({ id: "d", position: 2, status: "dismissed" }),
            ],
        });

        expect(done(a)).toEqual([true, true, true, true]);
        expect(weekSteps(a)[3]?.detail).toBe("2 of 2 decided");
    });

    it("treats a closed agenda as held", () => {
        const a = agenda({
            status: "closed",
            topics: [topic({ status: "kept", decision: "Agreed" })],
        });

        expect(done(a)).toEqual([true, true, true, true]);
    });

    it("never marks committing done with nothing kept, even once held", () => {
        expect(done(agenda({ status: "held" }))).toEqual([true, true, true, false]);
    });
});
