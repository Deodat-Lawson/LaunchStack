/**
 * Which Scenarios screen a location shows, and the words the tab uses for a
 * run's progress — plain functions, pinned here instead of by clicking.
 */
import { runPath, scenariosScreenFor } from "~/app/employer/tools/scenarios/_lib/screens";
import { moodWords, percent, progressValue, progressWords, signed } from "~/lib/scenarios/words";

describe("scenariosScreenFor", () => {
    it("maps the list, the form and a run", () => {
        expect(scenariosScreenFor("/")).toEqual({ kind: "list" });
        expect(scenariosScreenFor("/runs")).toEqual({ kind: "list" });
        expect(scenariosScreenFor("/new")).toEqual({ kind: "new" });
        expect(scenariosScreenFor("/runs/12")).toEqual({
            kind: "run",
            id: 12,
            tab: null,
            post: null,
            source: null,
            person: null,
        });
    });

    it("reads the sub-tab, a post, a source and a person from the query", () => {
        expect(scenariosScreenFor("/runs/3?tab=feed&post=p10&person=a1&source=E2")).toMatchObject({
            kind: "run",
            id: 3,
            tab: "feed",
            post: "p10",
            person: "a1",
            source: "E2",
        });
        // An unknown tab falls back to the screen's choice.
        expect(scenariosScreenFor("/runs/3?tab=graph")).toMatchObject({ tab: null });
    });

    it("has no screen for anything else", () => {
        expect(scenariosScreenFor("/runs/abc")).toEqual({ kind: "not-found" });
        expect(scenariosScreenFor("/settings")).toEqual({ kind: "not-found" });
    });

    it("builds run paths that round-trip", () => {
        const href = runPath(7, { tab: "people", person: "a3", post: null });
        expect(href).toBe("/runs/7?tab=people&person=a3");
        expect(scenariosScreenFor(href)).toMatchObject({ id: 7, tab: "people", person: "a3" });
    });
});

describe("scenario words", () => {
    const base = { agents: 30, rounds: 8, round: 0 };
    it("says where a run is", () => {
        expect(progressWords({ ...base, status: "queued", stage: "gathering" })).toBe(
            "Waiting to start"
        );
        expect(progressWords({ ...base, status: "running", stage: "gathering" })).toBe(
            "Gathering sources"
        );
        expect(progressWords({ ...base, status: "running", stage: "casting" })).toBe(
            "Building 30 people"
        );
        expect(progressWords({ ...base, round: 2, status: "running", stage: "simulating" })).toBe(
            "Round 3 of 8"
        );
        expect(progressWords({ ...base, status: "running", stage: "reporting" })).toBe(
            "Writing the report"
        );
        expect(progressWords({ ...base, status: "done", stage: "done" })).toBe("Done");
    });

    it("moves the bar forward through the stages", () => {
        const values = [
            progressValue({ ...base, status: "running", stage: "gathering" }),
            progressValue({ ...base, status: "running", stage: "casting" }),
            progressValue({ ...base, round: 4, status: "running", stage: "simulating" }),
            progressValue({ ...base, status: "running", stage: "reporting" }),
            progressValue({ ...base, status: "done", stage: "done" }),
        ];
        expect([...values].sort((a, b) => a - b)).toEqual(values);
        expect(values.at(-1)).toBe(100);
    });

    it("formats moods, signs and rates", () => {
        expect(moodWords(-1.5)).toBe("strongly critical");
        expect(moodWords(0.1)).toBe("mixed");
        expect(moodWords(0.8)).toBe("supportive");
        expect(signed(0.42)).toBe("+0.4");
        expect(signed(-1.2)).toBe("−1.2");
        expect(signed(0.01)).toBe("0.0");
        expect(percent(0.45)).toBe("45%");
        expect(percent(0.062)).toBe("6.2%");
    });
});
