import { describe, expect, it } from "vitest";

import { NotRecordedError, type ExchangeSource, type RecordedExchange } from "../lib/recorder";
import { createEnv } from "./env";
import { recordTerm, type RegisterPage } from "./pages";
import type { RegisterSegment } from "./segments";
import { PAGE_SIZE, WORLD_FORMAT, type Company, type RegisterWorld } from "./world";

const exchange = (status: number, body = ""): RecordedExchange => ({
    url: "",
    method: "GET",
    status,
    headers: {},
    body,
    truncated: false,
    ms: 1,
    at: "2026-01-01T00:00:00.000Z",
});

/** One page of the register's answer: `count` companies out of `total` matches. */
function page(count: number, total: number, firstId = 1): string {
    const json: RegisterPage = {
        _embedded: {
            enheter: Array.from({ length: count }, (_, i) => ({
                organisasjonsnummer: String(firstId + i),
                navn: `Company ${firstId + i}`,
                naeringskode1: { kode: "10.830" },
            })),
        },
        page: { totalElements: total, totalPages: Math.ceil(total / PAGE_SIZE) },
    };
    return JSON.stringify(json);
}

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

describe("recording a word's pages", () => {
    it("reads pages until the register runs out", async () => {
        const recorded = await recordTerm(
            "kaffe",
            source("replay", [exchange(200, page(PAGE_SIZE, 25)), exchange(200, page(5, 25, 100))]),
            10
        );
        expect(recorded).toMatchObject({ total: 25, requests: 2, cutShort: false });
        expect(recorded.pages.map(p => p.length)).toEqual([PAGE_SIZE, 5]);
    });

    it("marks a word cut short when its first page gets no answer", async () => {
        const recorded = await recordTerm("kaffe", source("replay", [exchange(503)]), 10);
        expect(recorded).toEqual({ pages: [], total: 0, requests: 0, cutShort: true });
    });

    it("marks a word cut short when a later page gets no answer", async () => {
        const recorded = await recordTerm(
            "kaffe",
            source("replay", [exchange(200, page(PAGE_SIZE, 60)), exchange(503)]),
            10
        );
        expect(recorded).toMatchObject({ total: 60, requests: 1, cutShort: true });
        expect(recorded.pages).toHaveLength(1);
    });

    it("asks again while recording", async () => {
        const recorder = source("record", [exchange(503), exchange(200, page(3, 3))]);
        const recorded = await recordTerm("kaffe", recorder, 10, { pauseMs: 0 });
        expect(recorder.asked).toBe(2);
        expect(recorded).toMatchObject({ requests: 1, cutShort: false });
    });

    it("lets a request that was never recorded stop the run", async () => {
        const recorder = source("replay", [
            new NotRecordedError("GET", "https://example.invalid/"),
        ]);
        await expect(recordTerm("kaffe", recorder, 10)).rejects.toBeInstanceOf(NotRecordedError);
    });
});

describe("a word that was cut short", () => {
    const segment: RegisterSegment = { id: "test", label: "Test", code: "10.830", plan: ["kaffe"] };
    const company = (id: string): Company => ({ id, name: `Company ${id}`, code: "10.830" });
    const world = (cutShort?: string[]): RegisterWorld => ({
        format: WORLD_FORMAT,
        segment,
        // "te" has no pages at all: either it matches nothing, or its first page got no answer.
        pages: { kaffe: [[company("1")]], te: [] },
        totals: { kaffe: 1, te: 0 },
        terms: { plan: ["kaffe", "te"], mined: [] },
        truth: ["1"],
        requests: 1,
        ...(cutShort ? { cutShort } : {}),
    });

    it("is never complete, where a word with no matches is", () => {
        expect(createEnv(world()).open("te").complete()).toBe(true);
        expect(
            createEnv(world(["te"]))
                .open("te")
                .complete()
        ).toBe(false);
    });

    it("leaves the other words as they were", () => {
        const cursor = createEnv(world(["te"])).open("kaffe");
        expect(cursor.next()?.map(item => item.id)).toEqual(["1"]);
        expect(cursor.complete()).toBe(true);
    });
});
