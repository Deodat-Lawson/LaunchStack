import { describe, expect, it } from "vitest";

import {
    buildQuestionBank,
    extractApplicationWindow,
    hasBatchStarted,
    normalizeYcOssCompany,
    parseBatchLabel,
    segmentApplication,
    sharedTerms,
} from "./similar-companies";

const ycOssRecord = {
    id: 5,
    name: "CircuitHub",
    slug: "circuithub",
    former_names: ["CircuitHub", " "],
    website: "https://circuithub.com",
    all_locations: "London, England, United Kingdom",
    long_description: "  ",
    one_liner: "On-Demand Electronics Manufacturing",
    team_size: 58,
    industries: ["Industrials", "Manufacturing and Robotics", "Industrials"],
    tags: ["Hardware"],
    regions: ["United Kingdom"],
    status: "Active",
    batch: "Winter 2012",
    url: "https://www.ycombinator.com/companies/circuithub",
    api: "https://yc-oss.github.io/api/batches/winter-2012/circuithub.json",
    app_answers: null,
};

describe("batches", () => {
    it("dates seasonal batches and rejects undated ones", () => {
        expect(parseBatchLabel("Summer 2009")).toEqual({
            season: "Summer",
            year: 2009,
            startsOn: "2009-06-01",
        });
        expect(parseBatchLabel("Unspecified")).toBeNull();
    });

    it("treats only started batches as accepted cohorts", () => {
        const now = new Date("2026-11-07T00:00:00Z");
        expect(hasBatchStarted("Fall 2026", now)).toBe(true);
        expect(hasBatchStarted("Winter 2027", now)).toBe(false);
        expect(hasBatchStarted("Unspecified", now)).toBe(false);
    });
});

describe("normalizeYcOssCompany", () => {
    it("keeps a stable per-program identity and turns blanks into unknowns", () => {
        const company = normalizeYcOssCompany(ycOssRecord, "y-combinator");
        expect(company).toMatchObject({
            id: "y-combinator:circuithub",
            externalId: "5",
            batchStartsOn: "2012-01-01",
            description: null,
            oneLiner: "On-Demand Electronics Manufacturing",
            formerNames: [],
            industries: ["Industrials", "Manufacturing and Robotics"],
        });
    });

    it("skips a record without a dated batch", () => {
        expect(
            normalizeYcOssCompany({ ...ycOssRecord, batch: "Unspecified" }, "y-combinator")
        ).toBeNull();
    });
});

describe("application text", () => {
    it("fails rather than storing the page when the start anchor moved", () => {
        expect(
            extractApplicationWindow("Nav\nBody", {
                startAt: "What is your company going to make?",
            })
        ).toBeNull();
        expect(
            extractApplicationWindow("Nav\nWhat is it?\nAnswer\nFooter", {
                startAt: "What is it?",
                endBefore: "Footer",
            })
        ).toBe("What is it?\nAnswer");
    });

    it("splits one-question-per-line applications and keeps answers that end in a question mark", () => {
        const window = [
            "What is your company going to make?",
            "Open source software to collaborate on code.",
            "How far along are you?",
            "Full-time, I have hard times being part-time on something ?",
            "Do you have revenue?",
            "",
        ].join("\n");
        expect(segmentApplication(window, [])).toEqual([
            {
                question: "What is your company going to make?",
                answer: "Open source software to collaborate on code.",
            },
            {
                question: "How far along are you?",
                answer: "Full-time, I have hard times being part-time on something ?",
            },
        ]);
    });

    it("treats instructions and bracketed questions as prompts but not answers that open with If", () => {
        const window = [
            "Where do you live now?",
            "Seattle, USA",
            "Explain your decision regarding location.",
            "Both founders have strong networks in Seattle.",
            "What was your revenue in the last full calendar month? (Please use USD.)",
            "If accepted, we will move to San Francisco.",
            "If you have already participated in an accelerator, please tell us about it.",
            "N/A",
        ].join("\n");
        expect(segmentApplication(window, []).map(section => section.question)).toEqual([
            "Where do you live now?",
            "Explain your decision regarding location.",
            "What was your revenue in the last full calendar month? (Please use USD.)",
            "If you have already participated in an accelerator, please tell us about it.",
        ]);
        expect(segmentApplication(window, [])[2]?.answer).toBe(
            "If accepted, we will move to San Francisco."
        );
    });

    it("finds shared prompts inside a copy that runs the form together", () => {
        const bank = buildQuestionBank([
            "What is your company going to make?\nA\nHow far along are you?\nB",
            "What is your company going to make?\nC\nHow far along are you?\nD",
        ]);
        const runTogether =
            "What is your company going to make? Notification inbox for apps. How far along are you? Launched.";
        expect(segmentApplication(runTogether, bank)).toEqual([
            {
                question: "What is your company going to make?",
                answer: "Notification inbox for apps.",
            },
            { question: "How far along are you?", answer: "Launched." },
        ]);
    });
});

describe("sharedTerms", () => {
    it("explains a match only with whole terms the profile also names", () => {
        const company = normalizeYcOssCompany(
            {
                ...ycOssRecord,
                industries: ["Industrials", "Supply Chain and Logistics"],
                tags: ["Logistics", "B2B", "AI", "Cold Chain"],
            },
            "y-combinator"
        );
        if (!company) throw new Error("fixture must normalize");
        const profile =
            "Temperature monitoring to maintain cold-chain compliance in food logistics. Business model: B2B subscription.";
        expect(sharedTerms(company, profile)).toEqual(["Logistics", "B2B", "Cold Chain"]);
    });
});
