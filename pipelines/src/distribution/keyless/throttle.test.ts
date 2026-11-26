/**
 * The per-host pause: one request at a time to a map server, with a gap,
 * shared by everything in the process. A fake clock stands in for time.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_HOST_GAPS_MS, createHostThrottle, throttledFetch } from "./throttle";

/** A clock that only moves when something sleeps or a task takes time. */
function fakeClock() {
    let now = 1_000_000;
    return {
        now: () => now,
        sleep: (ms: number) => {
            now += ms;
            return Promise.resolve();
        },
        advance: (ms: number) => {
            now += ms;
        },
    };
}

describe("host throttle", () => {
    it("asks for about one request a second from the public map servers by default", () => {
        expect(DEFAULT_HOST_GAPS_MS["photon.komoot.io"]).toBeGreaterThanOrEqual(1_000);
        expect(DEFAULT_HOST_GAPS_MS["api.openstreetmap.org"]).toBeGreaterThanOrEqual(1_000);
        expect(DEFAULT_HOST_GAPS_MS["nominatim.openstreetmap.org"]).toBeGreaterThanOrEqual(1_000);
    });

    it("starts each request to a host only after the pause since the last one ended", async () => {
        const clock = fakeClock();
        const throttle = createHostThrottle({ gapMs: { "photon.test": 1_100 }, ...clock });
        const started: number[] = [];
        const ended: number[] = [];
        const request = () =>
            throttle("photon.test", async () => {
                started.push(clock.now());
                clock.advance(150);
                ended.push(clock.now());
                return "ok";
            });
        expect(await Promise.all([request(), request(), request()])).toEqual(["ok", "ok", "ok"]);
        expect(started[0]).toBe(1_000_000);
        for (let i = 1; i < started.length; i++) {
            // Never overlapping, and a full pause after the one before finished.
            expect(started[i]! - ended[i - 1]!).toBe(1_100);
        }
    });

    it("does not wait when the pause has already passed", async () => {
        const clock = fakeClock();
        let slept = 0;
        const throttle = createHostThrottle({
            gapMs: { "photon.test": 1_100 },
            now: clock.now,
            sleep: ms => {
                slept += ms;
                return clock.sleep(ms);
            },
        });
        await throttle("photon.test", () => Promise.resolve(1));
        clock.advance(5_000);
        await throttle("photon.test", () => Promise.resolve(2));
        expect(slept).toBe(0);
    });

    it("keeps hosts apart: one host's queue never holds another's request back", async () => {
        const clock = fakeClock();
        const throttle = createHostThrottle({
            gapMs: { "photon.test": 1_100, "osm.test": 1_500 },
            ...clock,
        });
        const order: string[] = [];
        await Promise.all([
            throttle("photon.test", async () => void order.push("photon 1")),
            throttle("osm.test", async () => void order.push("osm 1")),
            throttle("unlisted.test", async () => void order.push("unlisted")),
        ]);
        expect(order.sort()).toEqual(["osm 1", "photon 1", "unlisted"]);
        // Nothing had to wait: three different hosts, first request each.
        expect(clock.now()).toBe(1_000_000);
    });

    it("lets the next request through after one fails", async () => {
        const clock = fakeClock();
        const throttle = createHostThrottle({ gapMs: { "photon.test": 1_100 }, ...clock });
        await expect(
            throttle("photon.test", () => Promise.reject(new Error("503")))
        ).rejects.toThrow("503");
        await expect(throttle("photon.test", () => Promise.resolve("next"))).resolves.toBe("next");
        expect(clock.now()).toBe(1_000_000 + 1_100);
    });

    it("wraps fetch so every request waits its host's turn", async () => {
        const clock = fakeClock();
        const throttle = createHostThrottle({ gapMs: { "photon.test": 1_100 }, ...clock });
        const at: number[] = [];
        const fetchImpl: typeof fetch = () => {
            at.push(clock.now());
            return Promise.resolve(new Response("{}"));
        };
        const polite = throttledFetch(fetchImpl, throttle);
        await polite("https://photon.test/api/?q=a");
        await polite(new URL("https://photon.test/api/?q=b"));
        await polite("https://elsewhere.test/");
        expect(at).toEqual([1_000_000, 1_001_100, 1_001_100]);
    });
});
